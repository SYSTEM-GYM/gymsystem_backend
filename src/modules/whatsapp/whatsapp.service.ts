import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as QRCode from 'qrcode';
import { Client, LocalAuth, Message, MessageAck } from 'whatsapp-web.js';
import { SUPABASE_CLIENT } from '../../shared/database/supabase.provider';

export type WaSessionStatus =
  | 'disconnected'
  | 'qr_pending'
  | 'connecting'
  | 'connected';

export type WaStatusResponse = {
  status: WaSessionStatus;
  connected: boolean;
  display_phone: string | null;
  qr_code: string | null;
  connected_at: string | null;
};

@Injectable()
export class WhatsappService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsappService.name);
  private client: Client | null = null;
  private status: WaSessionStatus = 'disconnected';
  private qrDataUrl: string | null = null;
  private displayPhone: string | null = null;
  private connectedAt: string | null = null;
  private initializing = false;
  private restoreAttempted = false;

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  onModuleInit() {
    if (this.hasStoredSession()) {
      this.logger.log('Sessão WhatsApp salva detectada — restaurando...');
      void this.connect().catch((err) => {
        this.logger.warn('Falha ao restaurar sessão WhatsApp na inicialização', err);
      });
    }
  }

  async onModuleDestroy() {
    await this.destroyClient();
  }

  getStatus(): WaStatusResponse {
    this.maybeRestoreSession();
    return {
      status: this.status,
      connected: this.status === 'connected',
      display_phone: this.displayPhone,
      qr_code: this.qrDataUrl,
      connected_at: this.connectedAt,
    };
  }

  private maybeRestoreSession() {
    if (
      this.status !== 'disconnected' ||
      this.initializing ||
      this.client ||
      !this.hasStoredSession()
    ) {
      return;
    }

    if (this.restoreAttempted) return;
    this.restoreAttempted = true;

    void this.connect()
      .catch(() => undefined)
      .finally(() => {
        if (this.status === 'disconnected') {
          this.restoreAttempted = false;
        }
      });
  }

  private hasStoredSession(): boolean {
    const authPath = path.join(process.cwd(), '.wwebjs_auth');
    if (!fs.existsSync(authPath)) return false;
    try {
      return fs.readdirSync(authPath).length > 0;
    } catch {
      return false;
    }
  }

  async connect(): Promise<WaStatusResponse> {
    if (this.status === 'connected') {
      return this.getStatus();
    }

    if (this.initializing) {
      return this.getStatus();
    }

    await this.destroyClient();
    this.initializing = true;
    this.status = 'connecting';
    this.qrDataUrl = null;

    const authPath = path.join(process.cwd(), '.wwebjs_auth');
    this.client = new Client({
      authStrategy: new LocalAuth({ dataPath: authPath }),
      puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      },
    });

    this.client.on('qr', (qr) => {
      void this.handleQr(qr);
    });

    this.client.on('authenticated', () => {
      this.status = 'connecting';
      this.qrDataUrl = null;
      this.logger.log('WhatsApp autenticado, aguardando sessão...');
    });

    this.client.on('ready', () => {
      void this.handleReady();
    });

    this.client.on('auth_failure', (msg) => {
      this.logger.error(`Falha de autenticação WhatsApp: ${msg}`);
      this.status = 'disconnected';
      this.qrDataUrl = null;
      this.initializing = false;
    });

    this.client.on('disconnected', (reason) => {
      this.logger.warn(`WhatsApp desconectado: ${reason}`);
      this.status = 'disconnected';
      this.displayPhone = null;
      this.connectedAt = null;
      this.qrDataUrl = null;
      this.client = null;
      this.initializing = false;
    });

    this.client.on('message_create', (msg) => {
      void this.handleMessageCreate(msg);
    });

    this.client.on('message_ack', (msg, ack) => {
      void this.handleMessageAck(msg, ack);
    });

    try {
      await this.client.initialize();
    } catch (err) {
      this.logger.error('Erro ao inicializar WhatsApp Web', err);
      this.status = 'disconnected';
      this.initializing = false;
      await this.destroyClient();
      throw new BadRequestException('Não foi possível iniciar o cliente WhatsApp.');
    }

    this.initializing = false;
    return this.getStatus();
  }

  async disconnect(): Promise<WaStatusResponse> {
    if (this.client) {
      try {
        await this.client.logout();
      } catch (err) {
        this.logger.warn('Erro ao fazer logout do WhatsApp', err);
      }
      await this.destroyClient();
    }

    this.status = 'disconnected';
    this.displayPhone = null;
    this.connectedAt = null;
    this.qrDataUrl = null;
    this.restoreAttempted = false;

    await this.clearIntegrationDb();
    return this.getStatus();
  }

  async sendMessage(
    phone: string,
    content: string,
  ): Promise<{ waMessageId: string }> {
    if (!this.client || this.status !== 'connected') {
      throw new BadRequestException(
        'WhatsApp não está conectado. Escaneie o QR Code na aba Conexão.',
      );
    }

    const digits = phone.replace(/\D/g, '');
    if (!this.isValidBrazilPhoneDigits(digits)) {
      throw new BadRequestException(
        'Telefone inválido. Atualize o contato com um número no formato +55DDD9XXXXXXXX.',
      );
    }

    try {
      const numberId = await this.client.getNumberId(digits);
      if (!numberId?._serialized) {
        throw new BadRequestException(
          'Número não registrado no WhatsApp ou inválido.',
        );
      }

      const sent = await this.client.sendMessage(
        numberId._serialized,
        content.trim(),
      );
      if (!sent?.id?._serialized) {
        throw new BadRequestException(
          'Não foi possível enviar a mensagem. Tente novamente.',
        );
      }

      return { waMessageId: sent.id._serialized };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error('Erro ao enviar mensagem WhatsApp', err);
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Erro ao enviar mensagem.',
      );
    }
  }

  private async handleQr(qr: string) {
    this.status = 'qr_pending';
    try {
      this.qrDataUrl = await QRCode.toDataURL(qr);
    } catch (err) {
      this.logger.error('Erro ao gerar QR Code', err);
      this.qrDataUrl = null;
    }
  }

  private async handleReady() {
    this.status = 'connected';
    this.qrDataUrl = null;
    this.connectedAt = new Date().toISOString();

    const wid = this.client?.info?.wid?.user;
    this.displayPhone = wid ? `+${wid}` : null;

    this.logger.log(`WhatsApp conectado: ${this.displayPhone ?? 'número desconhecido'}`);
    await this.persistIntegrationDb();
  }

  async syncContactsFromChats(): Promise<{ imported: number }> {
    if (!this.client || this.status !== 'connected') {
      throw new BadRequestException(
        'WhatsApp não está conectado. Escaneie o QR Code na aba Conexão.',
      );
    }

    const chats = await this.client.getChats();
    let imported = 0;

    for (const chat of chats) {
      if (chat.isGroup) continue;

      try {
        const waContact = await chat.getContact();
        const phone =
          this.digitsToE164(waContact.number ?? '') ??
          (await this.resolvePhoneFromWaId(chat.id._serialized));

        if (!phone) continue;

        const { error } = await this.supabase.from('wa_contacts').upsert(
          {
            phone,
            name: waContact.pushname ?? waContact.name ?? chat.name ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'phone' },
        );

        if (!error) imported++;
      } catch (err) {
        this.logger.warn(`Falha ao importar chat ${chat.id._serialized}`, err);
      }
    }

    return { imported };
  }

  private async handleMessageCreate(msg: Message) {
    if (!msg.body?.trim()) return;
    if (msg.from.endsWith('@g.us')) return;

    try {
      await this.persistMessage(msg);
    } catch (err) {
      this.logger.error('Erro ao processar mensagem WhatsApp', err);
    }
  }

  private async persistMessage(msg: Message) {
    const isOutbound = msg.fromMe;
    const waId = isOutbound ? msg.to : msg.from;
    const phone = await this.resolvePhoneFromWaId(waId);
    if (!phone) {
      this.logger.warn(`Não foi possível resolver telefone de ${waId}`);
      return;
    }

    const content = msg.body.trim();
    let contactName: string | null = null;
    try {
      const waContact = await msg.getContact();
      contactName = waContact.pushname ?? waContact.name ?? null;
    } catch {
      contactName = null;
    }

    const { data: contact, error: contactErr } = await this.supabase
      .from('wa_contacts')
      .upsert(
        {
          phone,
          name: contactName,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'phone' },
      )
      .select('id')
      .single();

    if (contactErr || !contact) {
      this.logger.error('Falha ao salvar contato', contactErr);
      return;
    }

    const waMessageId = msg.id._serialized;
    const createdAt = new Date(msg.timestamp * 1000).toISOString();

    const { data: existing } = await this.supabase
      .from('wa_messages')
      .select('id')
      .eq('wa_message_id', waMessageId)
      .maybeSingle();

    if (existing) return;

    if (isOutbound) {
      const { data: pending } = await this.supabase
        .from('wa_messages')
        .select('id')
        .eq('contact_id', contact.id)
        .eq('direction', 'outbound')
        .eq('content', content)
        .eq('status', 'pending')
        .is('wa_message_id', null)
        .gte('created_at', new Date(Date.now() - 60_000).toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (pending) {
        await this.supabase
          .from('wa_messages')
          .update({ status: 'sent', wa_message_id: waMessageId })
          .eq('id', pending.id);
        return;
      }
    }

    const { error: msgErr } = await this.supabase.from('wa_messages').insert({
      contact_id: contact.id,
      direction: isOutbound ? 'outbound' : 'inbound',
      content,
      status: isOutbound ? 'sent' : 'delivered',
      wa_message_id: waMessageId,
      created_at: createdAt,
    });

    if (msgErr) {
      this.logger.error('Falha ao salvar mensagem', msgErr);
    }
  }

  private async resolvePhoneFromWaId(waId: string): Promise<string | null> {
    if (!this.client) return null;

    try {
      const [resolved] = await this.client.getContactLidAndPhone([waId]);
      const fromPn = this.digitsToE164(resolved?.pn?.split('@')[0] ?? '');
      if (fromPn) return fromPn;
    } catch (err) {
      this.logger.warn(`Falha ao resolver LID/PN de ${waId}`, err);
    }

    if (waId.endsWith('@c.us') || waId.endsWith('@s.whatsapp.net')) {
      return this.digitsToE164(waId.split('@')[0] ?? '');
    }

    try {
      const contact = await this.client.getContactById(waId);
      if (contact?.number) {
        return this.digitsToE164(contact.number);
      }
    } catch {
      // ignore
    }

    return null;
  }

  private digitsToE164(digits: string): string | null {
    const normalized = digits.replace(/\D/g, '');
    if (!this.isValidBrazilPhoneDigits(normalized)) return null;
    return normalized.startsWith('55')
      ? `+${normalized}`
      : `+55${normalized}`;
  }

  private isValidBrazilPhoneDigits(digits: string): boolean {
    if (!digits) return false;
    if (!digits.startsWith('55')) return false;
    const national = digits.slice(2);
    return national.length >= 10 && national.length <= 11;
  }

  private async handleMessageAck(msg: Message, ack: MessageAck) {
    const status = this.mapAckStatus(ack);
    if (!status || !msg.id?._serialized) return;

    await this.supabase
      .from('wa_messages')
      .update({ status })
      .eq('wa_message_id', msg.id._serialized)
      .eq('direction', 'outbound');
  }

  private mapAckStatus(ack: MessageAck): string | null {
    switch (ack) {
      case MessageAck.ACK_ERROR:
        return 'failed';
      case MessageAck.ACK_PENDING:
        return 'pending';
      case MessageAck.ACK_SERVER:
        return 'sent';
      case MessageAck.ACK_DEVICE:
        return 'delivered';
      case MessageAck.ACK_READ:
      case MessageAck.ACK_PLAYED:
        return 'read';
      default:
        return null;
    }
  }

  private async persistIntegrationDb() {
    const { data: admin } = await this.supabase
      .from('users')
      .select('id')
      .eq('role', 'admin')
      .limit(1)
      .maybeSingle();

    if (!admin?.id) return;

    await this.supabase.from('wa_integration').upsert(
      {
        owner_id: admin.id,
        display_phone: this.displayPhone,
        connected_at: this.connectedAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'owner_id' },
    );
  }

  private async clearIntegrationDb() {
    await this.supabase
      .from('wa_integration')
      .update({
        display_phone: null,
        connected_at: null,
        updated_at: new Date().toISOString(),
      })
      .not('owner_id', 'is', null);
  }

  private async destroyClient() {
    if (!this.client) return;
    try {
      await this.client.destroy();
    } catch (err) {
      this.logger.warn('Erro ao destruir cliente WhatsApp', err);
    }
    this.client = null;
    this.initializing = false;
  }
}
