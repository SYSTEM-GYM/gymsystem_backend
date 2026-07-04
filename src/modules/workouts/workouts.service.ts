import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../shared/database/supabase.provider';
import { TenantContextService } from '../../shared/context/tenant-context.service';

export type GymWorkoutCollectionSummary = {
  id: string;
  name: string;
  estimatedDurationMinutes: number;
};

export type CollectionExercise = {
  id: string;
  exercise_id: string;
  sort_order: number;
  default_sets: number;
  default_reps: number;
  default_weight_kg: number | null;
  exercise: {
    id: string;
    title: string;
    description: string | null;
    youtube_url: string | null;
    webm_path: string | null;
  };
};

export type TodayWorkout = {
  collectionId: string;
  collectionName: string;
  estimatedDurationMinutes: number;
  scheduleType: string;
  exercises: CollectionExercise[];
};

@Injectable()
export class WorkoutsService {
  private readonly logger = new Logger(WorkoutsService.name);

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Proof of concept for TenantContextService: gym_id comes from the
   * AsyncLocalStorage-scoped request context (populated from the JWT's
   * app_metadata claims) instead of being passed in by the controller.
   */
  async findAllCollectionsForCurrentGym(): Promise<
    GymWorkoutCollectionSummary[]
  > {
    const gymId = this.tenantContext.getGymId();
    if (!gymId) return [];

    const { data, error } = await this.supabase
      .from('exercise_collections')
      .select('id, name, estimated_duration_minutes')
      .eq('gym_id', gymId)
      .order('name', { ascending: true });

    if (error) {
      this.logger.warn(
        `findAllCollectionsForCurrentGym failed: ${error.message}`,
      );
      return [];
    }

    return (data ?? []).map((row) => ({
      id: row.id as string,
      name: row.name as string,
      estimatedDurationMinutes: row.estimated_duration_minutes as number,
    }));
  }

  async getTodayWorkout(userId: string): Promise<TodayWorkout | null> {
    const dayOfWeek = new Date().getDay();

    const { data: weeklySchedule } = await this.supabase
      .from('workout_schedules')
      .select('collection_id, schedule_type, sort_order')
      .eq('user_id', userId)
      .eq('schedule_type', 'weekly')
      .eq('day_of_week', dayOfWeek)
      .order('sort_order', { ascending: true })
      .limit(1)
      .maybeSingle();

    let collectionId = weeklySchedule?.collection_id ?? null;

    if (!collectionId) {
      const { data: sessionSchedules } = await this.supabase
        .from('workout_schedules')
        .select('collection_id, sort_order')
        .eq('user_id', userId)
        .eq('schedule_type', 'session')
        .order('sort_order', { ascending: true });

      if (sessionSchedules && sessionSchedules.length > 0) {
        const { count } = await this.supabase
          .from('workout_execution_logs')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId);

        const idx = (count ?? 0) % sessionSchedules.length;
        collectionId = sessionSchedules[idx].collection_id;
      }
    }

    if (!collectionId) {
      const { data: customSchedule } = await this.supabase
        .from('workout_schedules')
        .select('collection_id')
        .eq('user_id', userId)
        .eq('schedule_type', 'custom')
        .order('sort_order', { ascending: true })
        .limit(1)
        .maybeSingle();

      collectionId = customSchedule?.collection_id ?? null;
    }

    if (!collectionId) return null;

    const { data: collection, error: colError } = await this.supabase
      .from('exercise_collections')
      .select('id, name, estimated_duration_minutes')
      .eq('id', collectionId)
      .single();

    if (colError || !collection) {
      this.logger.warn(`Collection not found: ${collectionId}`);
      return null;
    }

    const { data: rows, error: exError } = await this.supabase
      .from('collection_exercises')
      .select(
        `id, exercise_id, sort_order, default_sets, default_reps, default_weight_kg,
         exercise:exercises(id, title, description, youtube_url, webm_path)`,
      )
      .eq('collection_id', collectionId)
      .order('sort_order', { ascending: true });

    if (exError) {
      throw new NotFoundException('Exercícios da coleção não encontrados');
    }

    const exercises = (rows ?? [])
      .map((r) => {
        const raw = r.exercise as
          | CollectionExercise['exercise']
          | CollectionExercise['exercise'][];
        const ex = Array.isArray(raw) ? raw[0] : raw;
        if (!ex) return null;
        return {
          id: r.id as string,
          exercise_id: r.exercise_id as string,
          sort_order: r.sort_order as number,
          default_sets: r.default_sets as number,
          default_reps: r.default_reps as number,
          default_weight_kg: r.default_weight_kg as number | null,
          exercise: ex,
        };
      })
      .filter((e): e is CollectionExercise => e !== null);

    return {
      collectionId: collection.id,
      collectionName: collection.name,
      estimatedDurationMinutes: collection.estimated_duration_minutes,
      scheduleType: weeklySchedule?.schedule_type ?? 'session',
      exercises,
    };
  }
}
