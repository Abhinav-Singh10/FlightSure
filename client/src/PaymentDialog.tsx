import { useState } from 'react';
import type { StartPaymentInput } from '../../shared/types.ts';
import { AuthDialog } from './AuthDialog.tsx';
import { Button } from './components/ui/button.tsx';
import { Input } from './components/ui/input.tsx';
import { money } from './display.ts';

export function PaymentDialog({ amount, passengerName, onClose, onPay }: {
  amount: number;
  passengerName: string;
  onClose: () => void;
  onPay: (outcome: StartPaymentInput['outcome']) => void;
}) {
  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');
  const [cardName, setCardName] = useState(passengerName);
  const [error, setError] = useState('');

  function pay() {
    const digits = cardNumber.replace(/\s/g, '');
    if (!['4111111111111111', '4000000000000002', '4000000000003220'].includes(digits)) {
      setError('Use a demo card number, such as 4111 1111 1111 1111.'); return;
    }
    const month = Number(expiry.slice(0, 2));
    const year = Number(expiry.slice(3));
    const expiryMonth = `20${String(year).padStart(2, '0')}-${String(month).padStart(2, '0')}`;
    const currentMonth = new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 7);
    if (!/^\d{2}\/\d{2}$/.test(expiry) || month < 1 || month > 12 || expiryMonth < currentMonth) {
      setError('Enter a current or future expiry in MM/YY format.'); return;
    }
    if (!/^\d{3}$/.test(cvv) || !cardName.trim()) {
      setError('Enter a name on the card and a three-digit CVV.'); return;
    }
    // Fake card fields stay in this dialog. Only the simulator outcome is submitted.
    const outcome = digits === '4000000000000002' ? 'FAILURE'
      : digits === '4000000000003220' ? 'DELAYED_SUCCESS' : 'SUCCESS';
    onPay(outcome);
  }

  return <AuthDialog label="FlightSure demo payment" onClose={onClose}>
    <section className="overflow-hidden rounded-2xl bg-white">
      <div className="bg-slate-900 px-6 py-5 text-white">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-white/15 text-xl" aria-hidden="true">↗</span>
            <div><p className="font-semibold">FlightSure</p><p className="mt-0.5 text-xs text-slate-300">Flight reservation</p></div>
          </div>
          <button type="button" className="rounded-md px-2 py-1 text-slate-300 hover:bg-white/10 hover:text-white" aria-label="Close payment" onClick={onClose}>✕</button>
        </div>
        <div className="mt-6 flex items-end justify-between gap-3">
          <div><p className="text-xs text-slate-300">Amount to pay</p><p className="mt-1 text-3xl font-semibold">{money(amount)}</p></div>
          <span className="rounded bg-amber-300 px-2 py-1 text-[10px] font-bold tracking-wider text-slate-900">TEST MODE</span>
        </div>
      </div>
      <form className="space-y-4 p-6" autoComplete="off" onSubmit={(event) => { event.preventDefault(); pay(); }}>
        <div className="flex items-center gap-3 border-b border-border pb-4">
          <span className="rounded-lg bg-blue-50 px-3 py-2 text-lg text-blue-700" aria-hidden="true">▤</span>
          <div><h2 className="font-semibold">Pay with card</h2><p className="mt-0.5 text-xs text-muted-foreground">Use fake details only. No money is charged.</p></div>
        </div>
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        <label className="block text-sm font-medium">Card number
          <Input className="mt-2 tabular-nums" placeholder="4111 1111 1111 1111" inputMode="numeric" maxLength={19} required value={cardNumber}
            onChange={(event) => setCardNumber(event.target.value.replace(/\D/g, '').slice(0, 16).replace(/(\d{4})(?=\d)/g, '$1 '))} />
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label className="block text-sm font-medium">Expiry
            <Input className="mt-2" placeholder="MM/YY" inputMode="numeric" maxLength={5} required value={expiry}
              onChange={(event) => setExpiry(event.target.value.replace(/\D/g, '').slice(0, 4).replace(/^(\d{2})(\d)/, '$1/$2'))} />
          </label>
          <label className="block text-sm font-medium">CVV
            <Input className="mt-2" type="password" placeholder="•••" inputMode="numeric" maxLength={3} required value={cvv}
              onChange={(event) => setCvv(event.target.value.replace(/\D/g, '').slice(0, 3))} />
          </label>
        </div>
        <label className="block text-sm font-medium">Name on card
          <Input className="mt-2" maxLength={100} required value={cardName} onChange={(event) => setCardName(event.target.value)} />
        </label>
        <p className="rounded-lg bg-slate-50 p-3 text-xs leading-5 text-muted-foreground">Test card: <span className="font-medium text-foreground">4111 1111 1111 1111</span><br />Use any future expiry and any three-digit CVV.</p>
        <Button type="submit" className="w-full bg-blue-600 text-white hover:bg-blue-700">Pay {money(amount)}</Button>
        <p className="text-center text-[11px] text-muted-foreground">FlightSure demo checkout · Card details are not saved</p>
      </form>
    </section>
  </AuthDialog>;
}
