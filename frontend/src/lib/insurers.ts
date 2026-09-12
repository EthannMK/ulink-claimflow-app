// Per-insurer field schemas. These drive: manual New Claim entry, JD1/JD2 display,
// and the AI extraction context. Editable in Settings → Insurers & Fields; persisted.

export type FieldType = 'text' | 'number' | 'amount' | 'date' | 'select' | 'textarea'
export interface InsurerField { id: string; label: string; type: FieldType; required: boolean; aiHint: string; section: string; options?: string }
export interface InsurerConfig { id: string; name: string; fields: InsurerField[] }

const f = (id: string, label: string, type: FieldType, required = false, aiHint = '', section = '', options = ''): InsurerField =>
  ({ id, label, type, required, aiHint, section, options })

// Seeded from the AYA Sompo e-claim + the MGEN claim form Ulink shared.
export const DEFAULT_INSURERS: InsurerConfig[] = [
  {
    id: 'aya', name: 'AYA Sompo',
    fields: [
      f('issueNo', 'Issue No', 'text', false, 'Top of the e-claim form, e.g. CL/YGN/AYH/26018028', 'Policy Information'),
      f('product', 'Product Name', 'text', false, 'e.g. AYA Health Insurance (non-motor)', 'Policy Information'),
      f('policyHolder', 'Policy Holder Name', 'text', true, 'Usually the company/employer', 'Policy Information'),
      f('company', 'Company Name', 'text', false, 'Employer / group policy holder', 'Policy Information'),
      f('policyNo', 'Policy No', 'text', true, 'e.g. AYA/YGN/AYH/25000366', 'Policy Information'),
      f('claimant', 'Claimant Name', 'text', true, 'The patient / member', 'Policy Information'),
      f('nrc', 'Claimant NRC/Passport', 'text', true, 'National ID or passport number', 'Policy Information'),
      f('phone', 'Phone Number', 'text', false, '', 'Policy Information'),
      f('email', 'Email Address', 'text', false, '', 'Policy Information'),
      f('patientType', 'Type of Patient', 'select', false, 'Inpatient or Outpatient', 'Claim Information', 'Inpatient,Outpatient,Day Care'),
      f('admitDate', 'Admission/Visit Date', 'date', true, 'DD/MM/YY', 'Claim Information'),
      f('dischargeDate', 'Discharge Date', 'date', false, 'DD/MM/YY', 'Claim Information'),
      f('amount', 'Total Claim Amount', 'amount', true, 'Total amount claimed in MMK', 'Claim Information'),
      f('reportedDate', 'Reported Date', 'date', false, 'DD/MM/YY', 'Claim Information'),
      f('diagnosis', 'Detail of Illness/Injury', 'textarea', false, 'Diagnosis / reason for treatment', 'Claim Information'),
      f('doctor', 'Doctor Name', 'text', false, '', 'Claim Information'),
      f('hospital', 'Hospital/Clinic Name', 'text', true, 'Provider', 'Claim Information'),
      f('bankName', 'Bank Name', 'select', false, 'Accepted: AYA, CB, KBZ, YOMA', 'Bank Details', 'AYA,CB,KBZ,YOMA'),
      f('bankAccount', 'Bank Account Name', 'text', false, '', 'Bank Details'),
    ],
  },
  {
    id: 'mgen', name: 'MGEN',
    fields: [
      f('member', "Member's Name (according to NRC/Passport)", 'text', true, 'Section A, handwritten', "SECTION A – Patient's Details"),
      f('policyNo', 'Policy Number', 'text', true, 'e.g. handwritten above the printed sample', "SECTION A – Patient's Details"),
      f('employer', 'Name of employer', 'text', false, 'From the company email domain (mapping added later); leave blank if only a personal email (gmail etc.) or not present in the file', "SECTION A – Patient's Details"),
      f('dob', 'Date of Birth', 'date', false, 'DD/MM/YY', "SECTION A – Patient's Details"),
      f('phone', 'Contact Number', 'text', false, '', "SECTION A – Patient's Details"),
      f('email', 'Email Address', 'text', false, '', "SECTION A – Patient's Details"),
      f('diagnosis', 'Diagnosis or Nature of your illness/injury', 'textarea', false, "Section B 'Details of illness/injury' on page 1 — handwritten, may mix English and Burmese (e.g. appendicitis, clinic name)", 'SECTION B – Details of illness/Injury'),
      f('treatmentDate', 'Treatment Date', 'date', true, 'DD/MM/YY — date of first medical consultation', 'SECTION B – Details of illness/Injury'),
      f('hospital', 'Hospital/Clinic Name', 'text', true, '', 'SECTION B – Details of illness/Injury'),
      f('amount', 'Total Claimed Amount (with Currency Unit)', 'amount', true, 'Grand total at the bottom of the treatment table on page 2, above "Date of first medical consultation" (e.g. 2,521,100 MMK)', 'SECTION B – Details of illness/Injury'),
      f('bankName', 'Name of Bank', 'text', false, '', 'SECTION C – Bank Details'),
      f('bankHolder', 'Name of Bank Account Holder', 'text', false, '', 'SECTION C – Bank Details'),
      f('bankAccount', 'Bank Account Number', 'text', false, '', 'SECTION C – Bank Details'),
    ],
  },
  { id: 'mi', name: 'Myanma Insurance', fields: [] },
  { id: 'daiichi', name: 'Daiichi Life', fields: [] },
  { id: 'kbz', name: 'KBZ Life', fields: [] },
]
