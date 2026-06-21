type OperatingHour = {
  day_of_week: number;
  open_time: string;
  close_time: string;
  is_closed: boolean;
};

type Holiday = { date: string; is_closed: boolean };

/** Returns null when access is allowed, or a denial reason string. */
export function checkGymAccessHours(
  now: Date,
  hours: OperatingHour[],
  holidays: Holiday[],
): string | null {
  const todayIso = now.toISOString().split('T')[0];
  const holiday = holidays.find((h) => h.date === todayIso);
  if (holiday?.is_closed) {
    return 'Academia fechada hoje (feriado)';
  }

  if (hours.length === 0) {
    return null;
  }

  const dayOfWeek = now.getDay();
  const todayHours = hours.find((h) => h.day_of_week === dayOfWeek);

  if (!todayHours) {
    return null;
  }

  if (todayHours.is_closed) {
    return 'Academia fechada hoje';
  }

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [openH, openM] = todayHours.open_time.split(':').map(Number);
  const [closeH, closeM] = todayHours.close_time.split(':').map(Number);
  const openMinutes = openH * 60 + openM;
  const closeMinutes = closeH * 60 + closeM;

  if (currentMinutes < openMinutes || currentMinutes >= closeMinutes) {
    return `Fora do horário de funcionamento (${todayHours.open_time.slice(0, 5)}–${todayHours.close_time.slice(0, 5)})`;
  }

  return null;
}
