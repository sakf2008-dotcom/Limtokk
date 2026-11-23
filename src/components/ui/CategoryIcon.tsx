import { Brain, Cpu, FlaskConical, Globe, Heart, HeartPulse, Landmark, Leaf, Lightbulb, Rocket, Sigma, type LucideIcon } from "lucide-react";

/** Maps the icon keys stored in the categories table to drawn icons. Unknown keys fall back to a bulb. */
const ICONS: Record<string, LucideIcon> = {
  "flask-conical": FlaskConical,
  landmark: Landmark,
  globe: Globe,
  rocket: Rocket,
  cpu: Cpu,
  brain: Brain,
  sigma: Sigma,
  "heart-pulse": HeartPulse,
  leaf: Leaf,
  lightbulb: Lightbulb,
  heart: Heart,
};

export function CategoryIcon({ name, className = "size-6" }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? Lightbulb;
  return <Icon className={className} aria-hidden="true" />;
}
