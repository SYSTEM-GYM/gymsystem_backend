import { checkGymAccessHours } from './gym-hours.util';

describe('checkGymAccessHours', () => {
  const hours = [
    { day_of_week: 1, open_time: '06:00:00', close_time: '22:00:00', is_closed: false },
  ];

  it('allows access within operating hours', () => {
    const monday10am = new Date('2026-06-22T10:00:00');
    expect(checkGymAccessHours(monday10am, hours, [])).toBeNull();
  });

  it('denies access outside operating hours', () => {
    const monday5am = new Date('2026-06-22T05:00:00');
    expect(checkGymAccessHours(monday5am, hours, [])).toMatch(/Fora do horário/);
  });

  it('denies access on holidays', () => {
    const day = new Date('2026-06-22T10:00:00');
    const reason = checkGymAccessHours(day, hours, [
      { date: '2026-06-22', is_closed: true },
    ]);
    expect(reason).toMatch(/feriado/);
  });
});
