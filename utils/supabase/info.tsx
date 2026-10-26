import { SUPABASE_PROJECT_REF } from "../../src/supabaseConfig"

export const projectId = SUPABASE_PROJECT_REF
// Public browser credential only. Configure .env.local before building.
export const publicAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? ""
