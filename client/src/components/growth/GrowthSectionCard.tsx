type GrowthSectionCardProps = {
  title: string;
  description: string;
};

export function GrowthSectionCard({ title, description }: GrowthSectionCardProps) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
      <div className="text-sm font-semibold text-white">{title}</div>
      <p className="mt-3 text-sm leading-7 text-white/70">{description}</p>
    </div>
  );
}
