import gamfixIcon from "@/assets/gamfix-icon.png"

export default function GamFixMark({ className = "h-6 w-6" }: { className?: string }) {
  return <img src={gamfixIcon} className={className} alt="" aria-hidden="true" draggable={false} />
}
