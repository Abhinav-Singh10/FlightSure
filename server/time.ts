const istOffset = 330 * 60 * 1000;

// Shift UTC by IST's fixed offset, then remove the UTC suffix.
export function formatIst(date: Date) {
  return new Date(date.getTime() + istOffset).toISOString().slice(0, 19);
}

export function todayInIst() {
  return formatIst(new Date()).slice(0, 10);
}

export function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
