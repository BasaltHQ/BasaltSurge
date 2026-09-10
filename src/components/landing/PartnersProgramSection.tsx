import Link from "next/link";
import { ArrowRight, Building2, Globe, Handshake, Palette, ShoppingBag, Store, UtensilsCrossed, Wallet } from "lucide-react";

const benefits = [
  {
    icon: Palette,
    title: "Make it yours.",
    description: "Your domain, colors, and logo across a dedicated commerce platform.",
  },
  {
    icon: Store,
    title: "Grow your network.",
    description: "Bring merchants onboard with shops, QR terminals, receipts, and loyalty, plus tools to manage them.",
  },
  {
    icon: Wallet,
    title: "Share in every transaction.",
    description: "Earn your configured partner fee through automatic on-chain payment splits to your wallet.",
  },
];

const merchantTypes = [
  { icon: Store, label: "Retail" },
  { icon: UtensilsCrossed, label: "Dining" },
  { icon: ShoppingBag, label: "Online" },
];

export default function PartnersProgramSection() {
  return (
    <section
      id="partners-program"
      aria-labelledby="partners-program-heading"
      className="relative my-24 scroll-mt-24 overflow-hidden rounded-[2rem] border border-white/10 bg-[#0A0A0A] p-6 text-white sm:p-10 lg:p-16"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-pp-secondary opacity-10 blur-[100px]"
      />

      <div className="relative grid items-center gap-12 lg:grid-cols-[1.2fr_1fr] lg:gap-16">
        <div className="min-w-0">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-pp-secondary">
            <Handshake aria-hidden="true" className="h-4 w-4" />
            Partners Program
          </div>
          <h2 id="partners-program-heading" className="text-2xl font-black leading-[1.1] tracking-tight min-[375px]:text-3xl sm:text-4xl md:text-5xl xl:text-6xl">
            Your brand.<br />
            Your network.<br />
            <span className="text-pp-secondary">Our infrastructure.</span>
          </h2>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-zinc-400">
            Build your own payments business with BasaltSurge. Launch a branded
            commerce platform, support your merchants, and earn transaction
            revenue as your network grows.
          </p>
          <div className="mt-8 flex flex-col items-start gap-4">
            <Link
              href="/partners"
              className="group inline-flex min-h-12 w-full items-center justify-center gap-3 rounded-full bg-white px-6 py-3 text-center font-semibold text-black transition-colors hover:bg-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pp-secondary focus-visible:ring-offset-4 focus-visible:ring-offset-[#0A0A0A] sm:w-auto"
            >
              Explore the partner program
              <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0 transition-transform motion-safe:group-hover:translate-x-1" />
            </Link>
            <Link
              href="/partners#partner-application"
              className="inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-medium text-zinc-300 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pp-secondary focus-visible:ring-offset-4 focus-visible:ring-offset-[#0A0A0A]"
            >
              Start an application
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </div>
        </div>

        <figure className="relative min-w-0 rounded-3xl border border-white/10 bg-white/[0.02] p-4 sm:p-8">
          <div className="mb-8 flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-zinc-400">
            <Globe aria-hidden="true" className="h-4 w-4 shrink-0 text-pp-secondary" />
            Your commerce network
          </div>
          <div className="relative mx-auto max-w-60 rounded-2xl border border-white/15 bg-[#141414] p-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-pp-secondary">
              <Building2 aria-hidden="true" className="h-6 w-6" />
            </div>
            <div className="text-xl font-bold tracking-tight">Your brand</div>
            <div className="mt-1 text-xs text-zinc-400">Powered by BasaltSurge</div>
          </div>

          <div aria-hidden="true" className="mx-auto h-6 w-px bg-white/20" />
          <div aria-hidden="true" className="mx-auto h-6 w-2/3 rounded-t-xl border-x border-t border-white/20">
            <div className="mx-auto h-full w-px bg-white/20" />
          </div>
          <ul className="grid grid-cols-3 gap-2 sm:gap-3">
            {merchantTypes.map(({ icon: Icon, label }) => (
              <li key={label} className="flex flex-col items-center gap-3 rounded-xl border border-white/10 bg-[#141414] px-2 py-4">
                <Icon aria-hidden="true" className="h-5 w-5 text-pp-secondary" />
                <span className="text-xs font-medium text-zinc-300 sm:text-sm">{label}</span>
              </li>
            ))}
          </ul>
          <figcaption className="mt-6 border-t border-white/10 pt-5 text-center text-sm leading-relaxed text-zinc-400">
            One platform for your merchant network.<br />
            Your identity at every checkout.
          </figcaption>
        </figure>
      </div>

      <ul className="relative mt-12 grid gap-8 border-t border-white/10 pt-8 md:grid-cols-3 lg:mt-16">
        {benefits.map(({ icon: Icon, title, description }) => (
          <li key={title}>
            <Icon aria-hidden="true" className="mb-4 h-5 w-5 text-pp-secondary" />
            <h3 className="mb-2 text-lg font-semibold tracking-tight">{title}</h3>
            <p className="text-sm leading-relaxed text-zinc-400">{description}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
