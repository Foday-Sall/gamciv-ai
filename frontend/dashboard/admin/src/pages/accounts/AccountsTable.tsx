import type { ReactNode } from "react"
import { motion } from "framer-motion"
import { Card } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { Officer } from "@/lib/adminApi"
import RoleBadge from "./AccountBadges"

const containerVariants: { hidden: {}; shown: { transition: { staggerChildren: number } } } = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.05 } },
}

const rowVariants: { hidden: { opacity: number; y: number }; shown: { opacity: number; y: number } } = {
  hidden: { opacity: 0, y: 10 },
  shown: { opacity: 1, y: 0 },
}

/** Accounts list card: summary header strip plus the animated rows with
 *  activation switches. */
export default function AccountsTable({
  officers,
  busyId,
  onToggleActive,
  header,
}: {
  officers: Officer[]
  busyId: string | null
  onToggleActive: (officer: Officer, next: boolean) => void
  header: ReactNode
}) {
  return (
    <Card>
      {header}
      <motion.div variants={containerVariants} initial="hidden" animate="shown">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account</TableHead>
              <TableHead>Institution</TableHead>
              <TableHead>Role granted</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Active</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {officers.map((officer) => (
              <motion.tr
                key={officer.id}
                variants={rowVariants}
                whileHover={{ y: -2 }}
                className="border-b border-border transition-colors hover:bg-muted/40"
              >
                <TableCell>
                  <div>
                    <p className="font-medium">{officer.name}</p>
                    <p className="text-xs text-muted-foreground">{officer.email}</p>
                  </div>
                </TableCell>
                <TableCell>{officer.institutionName}</TableCell>
                <TableCell>
                  <RoleBadge role={officer.role} />
                </TableCell>
                <TableCell>{officer.department || "Unassigned"}</TableCell>
                <TableCell>
                  <Switch
                    checked={officer.active}
                    disabled={busyId === officer.id}
                    onCheckedChange={(next) => onToggleActive(officer, next)}
                    aria-label={`Toggle account for ${officer.name}`}
                  />
                </TableCell>
              </motion.tr>
            ))}
          </TableBody>
        </Table>
      </motion.div>
    </Card>
  )
}
