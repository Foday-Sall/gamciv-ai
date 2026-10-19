// Minimal complaint shape used by the institute dashboard feed.
export type Complaint = {
  id: string
  tracking_no: string
  title: string
  description: string
  urgency: string
  status: string
  created_at: string
  updated_at: string | null
  citizen_name: string | null
  citizen_phone: string | null
  resolution_photo_url: string | null
  institution_id: string | null
}
