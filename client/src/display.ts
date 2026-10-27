export function money(paise: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paise / 100);
}

export function flightTime(date: string) {
  return date.slice(11, 16);
}

export function flightDate(date: string) {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(`${date.slice(0, 10)}T00:00:00+05:30`));
}

export function today() {
  return new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);
}

export function tomorrow() {
  return new Date(Date.now() + 330 * 60 * 1000 + 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}
