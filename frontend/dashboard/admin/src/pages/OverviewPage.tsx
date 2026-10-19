import { useEffect, useState } from "react"
import { motion, type Variants } from "framer-motion"
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  LineChart,
  Line,
  Legend,
} from "recharts"
import { Inbox, FolderOpen, ArrowUpRight, Timer } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/PageHeader"
import { AnimatedNumber } from "@/components/AnimatedNumber"
import { getOverviewStats, type OverviewStats } from "@/lib/adminApi"

const containerVariants: Variants = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.06 } },
}

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" } },
}

const STAT_META = [
  { key: "totalComplaints", label: "Total complaints", Icon: Inbox },
  { key: "openComplaints", label: "Open complaints", Icon: FolderOpen },
  { key: "escalatedToday", label: "Escalated today", Icon: ArrowUpRight },
  { key: "avgFirstResponseHours", label: "Avg first response", Icon: Timer },
] as const

export default function OverviewPage() {
  const [stats, setStats] = useState<OverviewStats | null>(null)

  useEffect(() => {
    let cancelled = false
    getOverviewStats().then((data) => {
      if (!cancelled) setStats(data)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div>
      <PageHeader
        title="Overview"
        description="Complaint volume and response performance across every institution."
      />

      {!stats ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((key) => (
            <Card key={key}>
              <CardContent className="p-6">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="mt-3 h-9 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="shown"
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        >
          {STAT_META.map(({ key, label, Icon }) => (
            <motion.div key={key} variants={itemVariants}>
              <Card className="transition-colors hover:border-primary/40">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">{label}</p>
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                      <Icon className="h-4 w-4" style={{ strokeWidth: 1.75 }} aria-hidden="true" />
                    </span>
                  </div>
                  <div className="mt-2">
                    {key === "avgFirstResponseHours" ? (
                      <AnimatedNumber value={stats[key]} decimals={1} suffix="h" />
                    ) : (
                      <AnimatedNumber value={stats[key]} />
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <motion.div variants={itemVariants} initial="hidden" animate="shown">
          <Card>
            <CardHeader>
              <CardTitle>Complaints per category</CardTitle>
              <CardDescription>All-time distribution across categories</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-80 w-full">
                {stats ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stats.complaintsByCategory} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgb(31, 39, 53)" vertical={false} />
                      <XAxis
                        dataKey="category"
                        tick={{ fill: "rgb(138, 148, 166)", fontSize: 11 }}
                        axisLine={{ stroke: "rgb(31, 39, 53)" }}
                        tickLine={false}
                        interval={0}
                        angle={-30}
                        textAnchor="end"
                        height={56}
                      />
                      <YAxis tick={{ fill: "rgb(138, 148, 166)", fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip
                        cursor={{ fill: "rgba(255,255,255,0.04)" }}
                        contentStyle={{
                          background: "rgb(19, 26, 38)",
                          border: "1px solid rgb(31, 39, 53)",
                          borderRadius: 8,
                          color: "rgb(230, 235, 242)",
                          fontSize: 12,
                        }}
                      />
                      <Bar dataKey="count" name="Complaints" fill="rgb(47, 158, 110)" radius={[6, 6, 0, 0]} maxBarSize={44} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <Skeleton className="h-full w-full" />
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={itemVariants} initial="hidden" animate="shown">
          <Card>
            <CardHeader>
              <CardTitle>Receipts vs resolutions</CardTitle>
              <CardDescription>Daily totals for the last 14 days</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-80 w-full">
                {stats ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={stats.last14Days} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgb(31, 39, 53)" vertical={false} />
                      <XAxis
                        dataKey="date"
                        tick={{ fill: "rgb(138, 148, 166)", fontSize: 11 }}
                        axisLine={{ stroke: "rgb(31, 39, 53)" }}
                        tickLine={false}
                      />
                      <YAxis tick={{ fill: "rgb(138, 148, 166)", fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip
                        cursor={{ stroke: "rgb(35, 45, 61)" }}
                        contentStyle={{
                          background: "rgb(19, 26, 38)",
                          border: "1px solid rgb(31, 39, 53)",
                          borderRadius: 8,
                          color: "rgb(230, 235, 242)",
                          fontSize: 12,
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12, color: "rgb(138, 148, 166)" }} iconType="plainline" />
                      <Line
                        type="monotone"
                        dataKey="received"
                        name="Received"
                        stroke="rgb(79, 143, 217)"
                        strokeWidth={2.5}
                        dot={{ r: 2.5, fill: "rgb(79, 143, 217)", strokeWidth: 0 }}
                        activeDot={{ r: 4 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="resolved"
                        name="Resolved"
                        stroke="rgb(47, 158, 110)"
                        strokeWidth={2.5}
                        dot={{ r: 2.5, fill: "rgb(47, 158, 110)", strokeWidth: 0 }}
                        activeDot={{ r: 4 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <Skeleton className="h-full w-full" />
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  )
}
