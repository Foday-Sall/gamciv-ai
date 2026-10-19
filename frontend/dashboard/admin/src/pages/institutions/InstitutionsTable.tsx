import { motion } from "framer-motion"
import { Building2 } from "lucide-react"
import { Card } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { Institution } from "@/lib/adminApi"
import { AccessBadge, StatusBadge } from "./InstitutionBadges"

const containerVariants: { hidden: {}; shown: { transition: { staggerChildren: number } } } = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.05 } },
}

const rowVariants: { hidden: { opacity: number; y: number }; shown: { opacity: number; y: number } } = {
  hidden: { opacity: 0, y: 10 },
  shown: { opacity: 1, y: 0 },
}

/** Institutions list card with the animated rows. */
export default function InstitutionsTable({
  institutions,
  totalOpen,
  onSelect,
}: {
  institutions: Institution[]
  totalOpen: number
  onSelect: (institution: Institution) => void
}) {
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Building2 className="h-4 w-4" style={{ strokeWidth: 1.75 }} aria-hidden="true" />
          {institutions.length} institutions, {totalOpen} open complaints in total
        </p>
      </div>
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="shown"
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Institution</TableHead>
              <TableHead>Open complaints</TableHead>
              <TableHead>Accounts</TableHead>
              <TableHead>Access level</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {institutions.map((institution) => (
              <motion.tr
                key={institution.id}
                variants={rowVariants}
                className="cursor-pointer border-b border-border transition-colors hover:bg-muted/40"
                whileHover={{ y: -2 }}
                onClick={() => onSelect(institution)}
              >
                <TableCell>
                  <div>
                    <p className="font-medium">{institution.name}</p>
                    <p className="text-xs text-muted-foreground">{institution.shortCode}</p>
                  </div>
                </TableCell>
                <TableCell className="tabular">{institution.openComplaints}</TableCell>
                <TableCell className="tabular">{institution.officers}</TableCell>
                <TableCell>
                  <AccessBadge level={institution.accessLevel} />
                </TableCell>
                <TableCell>
                  <StatusBadge status={institution.status} />
                </TableCell>
              </motion.tr>
            ))}
          </TableBody>
        </Table>
      </motion.div>
    </Card>
  )
}
