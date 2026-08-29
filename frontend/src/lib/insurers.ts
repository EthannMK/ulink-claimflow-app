// Per-insurer field schemas. These drive: manual New Claim entry, JD1/JD2 display,
// and the AI extraction context. Editable in Settings → Insurers & Fields; persisted.

export type FieldType = 'text' | 'number' | 'amount' | 'date' | 'select' | 'textarea'
export interface InsurerField { id: string; label: string; type: FieldType; required: boolean; aiHint: string; options?: string }
export interface InsurerConfig { id: string; name: string; fields: InsurerField[] }

const f = (id: string, label: string, type: FieldType, required = false, aiHint = '', options = ''): InsurerField => ({ id, label, type, required, aiHint, options })

// Seeded from the AYA Sompo e-claim notification + MGEN sample forms Ulink shared.
export const DEFAULT_INSURERS: InsurerConfig[] = [
  {
    id: 'aya', name: 'AYA Sompo',
    fields: [
      f('issueNo', 'Issue No', 'text', false, 'Top of the e-claim form, e.g. CL/YGN/AYH/26018028'),
      f('product', 'Product Name', 'text', false, 'e.g. AYA Health Insurance (non-motor)'),
      f('policyHolder', 'Policy Holder Name', 'text', true, 'Usually the company/employer'),
      f('company', 'Company Name', 'text', false, 'Employer / group policy holder'),
      f('policyNo', 'Policy No', 'text', true, 'e.g. AYA/YGN/AYH/25000366'),
      f('claimant', 'Claimant Name', 'text', true, 'The patient / member'),
      f('nrc', 'Claimant NRC/Passport', 'text', true, 'National ID or passport number'),
      f('phone', 'Phone Number', 'text', false, ''),
      f('email', 'Email Address', 'text', false, ''),
      f('patientType', 'Type of Patient', 'select', false, 'Inpatient or Outpatient', 'Inpatient,Outpatient,Day Care'),
      f('accidentDate', 'Accident/Onset Date', 'date', false, ''),
      f('admitDate', 'Admission/Visit Date', 'date', true, ''),
      f('dischargeDate', 'Discharge Date', 'date', false, ''),
      f('amount', 'Total Claim Amount', 'amount', true, 'Total amount claimed in MMK'),
      f('reportedDate', 'Reported Date', 'date', false, ''),
      f('diagnosis', 'Detail of Illness/Injury', 'textarea', false, 'Diagnosis / reason for treatment'),
      f('doctor', 'Doctor Name', 'text', false, ''),
      f('hospital', 'Hospital/Clinic Name', 'text', true, 'Provider'),
      f('bankName', 'Bank Name', 'select', false, 'Accepted: AYA, CB, KBZ, YOMA', 'AYA,CB,KBZ,YOMA'),
      f('bankAccount', 'Bank Account Name', 'text', false, ''),
    ],
  },
  {
    id: 'mgen', name: 'MGEN',
    fields: [
      f('member', 'Member Name', 'text', true, 'Policy holder / claimant'),
      f('policyNo', 'Policy No', 'text', true, 'e.g. MG-100234'),
      f('employer', 'Employer', 'text', false, 'Group policy holder'),
      f('dob', 'Date of Birth', 'date', false, ''),
      f('phone', 'Contact Number', 'text', false, ''),
      f('email', 'Email', 'text', false, ''),
      f('treatmentDate', 'Treatment Date', 'date', true, ''),
      f('hospital', 'Hospital / Provider', 'text', true, ''),
      f('diagnosis', 'Diagnosis', 'textarea', false, ''),
      f('amount', 'Claim Amount', 'amount', true, 'In MMK'),
    ],
  },
  { id: 'mi', name: 'Myanma Insurance', fields: [] },
  { id: 'daiichi', name: 'Daiichi Life', fields: [] },
  { id: 'kbz', name: 'KBZ Life', fields: [] },
]
