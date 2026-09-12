// Per-insurer field schemas, split by FORM TYPE (Claim form vs LOG request).
// These drive: manual New Claim entry, JD1/JD2 display, and the AI extraction context.
// Editable in Settings → Insurers & Fields; persisted under settings.insurers.v3.

export type FieldType = 'text' | 'number' | 'amount' | 'date' | 'time' | 'select' | 'textarea'
export type FormType = 'claim' | 'log'

export interface InsurerField { id: string; label: string; type: FieldType; required: boolean; aiHint: string; section: string; options?: string }
// An insurer offers a Claim form, a LOG form, or both. A missing key = that form
// does not exist for the insurer (e.g. AMI is LOG-only, so `claim` is absent).
export interface InsurerForms { claim?: InsurerField[]; log?: InsurerField[] }
export interface InsurerConfig { id: string; name: string; forms: InsurerForms }

export const FORM_LABELS: Record<FormType, string> = { claim: 'Claim form', log: 'LOG request' }

/** Which form types this insurer actually has configured (a present key = has that form). */
export function formTypesOf(i: InsurerConfig): FormType[] {
  return (['claim', 'log'] as FormType[]).filter((t) => i.forms[t] !== undefined)
}
/** Fields for a given form type (empty array when the form isn't configured). */
export function fieldsFor(i: InsurerConfig | undefined, t: FormType): InsurerField[] {
  return (i && i.forms[t]) || []
}

const f = (id: string, label: string, type: FieldType, required = false, aiHint = '', section = '', options = ''): InsurerField =>
  ({ id, label, type, required, aiHint, section, options })

// ---- AYA SOMPO (Claim + LOG) — from the Ulink "required fields" sheet ----
const AYA_POLICY = (): InsurerField[] => [
  f('product', 'Product Name', 'text', false, '', 'Policy Information'),
  f('policyNo', 'Policy Number', 'text', true, 'e.g. AYA/YGN/AYH/25000366', 'Policy Information'),
  f('policyHolder', 'Policy Holder Name', 'text', true, '', 'Policy Information'),
  f('claimant', 'Claimant Name', 'text', true, 'The patient / member', 'Policy Information'),
  f('company', 'Company Name', 'text', false, 'Employer / group policy holder', 'Policy Information'),
  f('isChild', 'Is this claim for a child?', 'select', false, '', 'Policy Information', 'Yes,No'),
  f('claimantNrc', 'Claimant NRC/Passport', 'text', true, 'National ID or passport number', 'Policy Information'),
  f('holderNrc', "Policy holder's NRC / Parent's NRC (for a child)", 'text', false, 'Parent/policy-holder NRC when the claim is for a child', 'Policy Information'),
  f('dob', 'Claimant Date of Birth', 'date', false, 'DD/MM/YY', 'Policy Information'),
  f('phone', 'Phone Number', 'text', false, '', 'Policy Information'),
  f('email', 'Email Address', 'text', false, '', 'Policy Information'),
]

const AYA_CLAIM: InsurerField[] = [
  ...AYA_POLICY(),
  f('patientType', 'Type of Patient', 'select', false, 'Inpatient / Outpatient / Day Care', 'Claim Information', 'Inpatient,Outpatient,Day Care'),
  f('visitedDate', 'Visited Date', 'date', true, 'DD/MM/YY', 'Claim Information'),
  f('visitTime', 'Visit Time', 'time', false, '', 'Claim Information'),
  f('diagnosis', 'Detail of illness injury', 'textarea', false, 'Diagnosis / reason for treatment', 'Claim Information'),
  f('doctor', 'Doctor Name', 'text', false, '', 'Claim Information'),
  f('hospital', 'Hospital or Clinic Name', 'text', true, 'Provider', 'Claim Information'),
  f('treatmentDesc', 'Full Description of Treatment', 'textarea', false, '', 'Claim Information'),
  f('amount', 'Total Claim Amount', 'amount', true, 'Total amount claimed in MMK', 'Claim Information'),
  f('medicalRecords', 'Medical Records', 'text', false, 'Whether medical records are attached', 'Claim Information'),
  f('billPhotos', 'Bill Photos', 'text', false, 'Whether bill/invoice photos are attached', 'Claim Information'),
  f('outsideMyanmar', 'Is the claim for treatment outside Myanmar?', 'select', false, '', 'Claim Information', 'Yes,No'),
  f('bankName', 'Bank Name', 'text', false, '', 'Bank Information'),
  f('bankBranch', 'Bank Branch Name', 'text', false, '', 'Bank Information'),
  f('bankAccountName', 'Bank Account Name', 'text', false, '', 'Bank Information'),
  f('bankAccountNo', 'Bank Account Number', 'text', false, '', 'Bank Information'),
]

const AYA_LOG: InsurerField[] = [
  ...AYA_POLICY(),
  f('patientType', 'Type of Patient', 'select', false, 'Inpatient / Outpatient / Day Care', 'Claim Information', 'Inpatient,Outpatient,Day Care'),
  f('appointmentDate', 'Appointment Date / Visit Date', 'date', true, 'DD/MM/YY', 'Claim Information'),
  f('appointmentTime', 'Appointment Time', 'time', false, '', 'Claim Information'),
  f('diagnosis', 'Detail of illness injury', 'textarea', false, 'Diagnosis / reason for treatment', 'Claim Information'),
  f('doctor', 'Doctor Name', 'text', false, '', 'Claim Information'),
  f('hospital', 'Hospital or Clinic Name', 'text', true, 'Provider', 'Claim Information'),
  f('priorMedical', 'Prior Medical Records', 'textarea', false, 'Marked with a note on the form — confirm requirement', 'Claim Information'),
  f('estimatedAmount', 'Estimated Amount', 'amount', true, 'Estimated treatment cost in MMK', 'Claim Information'),
  f('outsideMyanmar', 'Is the claim for treatment outside Myanmar?', 'select', false, '', 'Claim Information', 'Yes,No'),
]

// ---- MGEN — existing Claim fields migrated; LOG pending the MGEN sheet ----
const MGEN_CLAIM: InsurerField[] = [
  f('member', "Member's Name (according to NRC/Passport)", 'text', true, 'Section A, handwritten', "SECTION A – Patient's Details"),
  f('policyNo', 'Policy Number', 'text', true, 'Handwritten above the printed sample', "SECTION A – Patient's Details"),
  f('employer', 'Name of employer', 'text', false, 'From the company email domain (mapping added later); leave blank for personal email (gmail etc.) or if not present', "SECTION A – Patient's Details"),
  f('dob', 'Date of Birth', 'date', false, 'DD/MM/YY', "SECTION A – Patient's Details"),
  f('phone', 'Contact Number', 'text', false, '', "SECTION A – Patient's Details"),
  f('email', 'Email Address', 'text', false, '', "SECTION A – Patient's Details"),
  f('diagnosis', 'Diagnosis or Nature of illness/injury', 'textarea', false, "Section B on page 1 — handwritten, may mix English and Burmese", 'SECTION B – Details of illness/Injury'),
  f('treatmentDate', 'Treatment Date', 'date', true, 'DD/MM/YY — date of first medical consultation', 'SECTION B – Details of illness/Injury'),
  f('hospital', 'Hospital/Clinic Name', 'text', true, '', 'SECTION B – Details of illness/Injury'),
  f('amount', 'Total Claimed Amount (with Currency Unit)', 'amount', true, 'Grand total at the bottom of the treatment table on page 2 (e.g. 2,521,100 MMK)', 'SECTION B – Details of illness/Injury'),
  f('bankName', 'Name of Bank', 'text', false, '', 'SECTION C – Bank Details'),
  f('bankHolder', 'Name of Bank Account Holder', 'text', false, '', 'SECTION C – Bank Details'),
  f('bankAccount', 'Bank Account Number', 'text', false, '', 'SECTION C – Bank Details'),
  // Section E is a document checklist rather than extracted values — tracked as present/not.
  f('matMedical', 'Medical records', 'select', false, 'Required claim material', 'SECTION E – Claim Materials', 'Provided,Not provided'),
  f('matInvestigation', 'Investigation reports', 'select', false, 'Required claim material', 'SECTION E – Claim Materials', 'Provided,Not provided'),
  f('matReceipts', 'Receipts / Invoices (incl. detailed bill breakdown)', 'select', false, 'Required claim material', 'SECTION E – Claim Materials', 'Provided,Not provided'),
  f('matIdInsured', 'ID copy of the insured', 'select', false, 'Required claim material', 'SECTION E – Claim Materials', 'Provided,Not provided'),
  f('matIdBankHolder', 'ID copy of the bank account holder (if not the insured)', 'select', false, 'Only if the account holder is not the insured', 'SECTION E – Claim Materials', 'Provided,Not provided,N/A'),
  f('matIdParent', 'ID copy of the parent (if the insured is underage)', 'select', false, 'Only if the insured is a child', 'SECTION E – Claim Materials', 'Provided,Not provided,N/A'),
]

const MGEN_LOG: InsurerField[] = [
  f('member', "Member's Name", 'text', true, '', "Patient's Details"),
  f('policyNo', 'Policy Number', 'text', true, '', "Patient's Details"),
  f('employer', 'Name of employer', 'text', false, 'From the company email domain (mapping added later); leave blank for personal email', "Patient's Details"),
  f('nrc', 'NRC Number or Passport Number', 'text', false, '', "Patient's Details"),
  f('dob', 'Date of Birth', 'date', false, 'DD/MM/YY', "Patient's Details"),
  f('email', 'Contact Email Address', 'text', false, '', "Patient's Details"),
  f('phone', 'Contact Phone Number', 'text', false, '', "Patient's Details"),
  f('hospital', 'Hospital / Clinic Name', 'text', true, '', 'Visit Details'),
  f('appointmentDate', 'Appointment / Admission Date', 'date', true, 'DD/MM/YY', 'Visit Details'),
  f('doctor', 'Doctor Name', 'text', false, '', 'Visit Details'),
  f('visitType', 'Type of Visit', 'select', false, 'Inpatient / Outpatient / Day Care', 'Visit Details', 'Inpatient,Outpatient,Day Care'),
  f('symptoms', 'Description of symptoms', 'textarea', false, '', 'Visit Details'),
  f('stayLength', 'Length of hospital stay if In-patient (optional)', 'text', false, 'Optional — only for in-patient', 'Visit Details'),
  f('estimatedCost', 'Estimated cost if In-patient (optional)', 'amount', false, 'Optional — only for in-patient', 'Visit Details'),
]

// ---- AMI Life Insurance — LOG only, no claim form ----
const AMI_LOG: InsurerField[] = [
  f('member', "Member's Name", 'text', true, '', "Patient's Details"),
  f('policyNo', 'Policy Number', 'text', true, '', "Patient's Details"),
  f('nrc', 'NRC Number or Passport Number', 'text', false, '', "Patient's Details"),
  f('dob', 'Date of Birth', 'date', false, 'DD/MM/YY', "Patient's Details"),
  f('email', 'Contact Email Address', 'text', false, '', "Patient's Details"),
  f('phone', 'Contact Phone Number', 'text', false, '', "Patient's Details"),
  f('hospital', 'Hospital / Clinic Name', 'text', true, '', 'Visit Details'),
  f('appointmentDate', 'Appointment / Admission Date', 'date', true, 'DD/MM/YY', 'Visit Details'),
  f('doctor', 'Doctor Name', 'text', false, '', 'Visit Details'),
  f('visitType', 'Type of Visit', 'select', false, 'Inpatient / Outpatient / Day Care', 'Visit Details', 'Inpatient,Outpatient,Day Care'),
  f('relatedSurgery', 'Related to Surgery', 'select', false, '', 'Visit Details', 'Yes,No'),
  f('relatedMiscarriage', 'Related to Miscarriage', 'select', false, '', 'Visit Details', 'Yes,No'),
  f('symptoms', 'Description of symptoms', 'textarea', false, '', 'Visit Details'),
  f('stayLength', 'Length of hospital stay if In-patient (optional)', 'text', false, 'Optional — only for in-patient', 'Visit Details'),
  f('estimatedCost', 'Estimated cost if In-patient (optional)', 'amount', false, 'Optional — only for in-patient', 'Visit Details'),
]

// ---- Daiichi Life (Daiichi Health CARE) — Claim + LOG ----
const DAIICHI_CLAIM: InsurerField[] = [
  f('claimDate', 'Claim Submission Date', 'date', false, 'DD/MM/YY', 'Claim Details'),
  f('policyNo', 'Policy Number', 'text', true, '', 'Claim Details'),
  f('priorClaim', 'Claimed from Daiichi Life (past) or any other insurer for this claim?', 'select', false, 'Have you claimed from Daiichi Life Insurance Myanmar Ltd. (in the past) or any other insurance companies for this particular claim?', 'Claim Details', 'Yes,No'),
  f('fullName', 'Full Name', 'text', true, 'Life insured', "Life Insured's Information"),
  f('nrc', 'NRC / Passport Number', 'text', false, '', "Life Insured's Information"),
  f('phone', 'Phone Number', 'text', false, '', "Life Insured's Information"),
  f('email', 'Email', 'text', false, '', "Life Insured's Information"),
  f('hospital', 'Hospital of treatment', 'text', true, '', 'General Information for Health Claim Benefit'),
  f('doctor', "Undertaking doctor(s)'s name", 'text', false, '', 'General Information for Health Claim Benefit'),
  f('cause', 'Cause of hospitalization / clinic visit', 'textarea', false, '', 'General Information for Health Claim Benefit'),
  f('admitDates', 'Date(s) of hospital admission / clinic visit', 'text', false, 'DD/MM/YY (may be a range or multiple dates)', 'General Information for Health Claim Benefit'),
  f('charges', 'Treatment Charges', 'amount', true, 'Total treatment charges in MMK', 'General Information for Health Claim Benefit'),
  f('icu', 'ICU requirement (if any)', 'select', false, '', 'General Information for Health Claim Benefit', 'Yes,No'),
  // Required Claim Documents — tracked as present/not
  f('docClaimForm', 'This Claim Form, duly completed', 'select', false, 'Required document', 'Required Claim Documents', 'Provided,Not provided'),
  f('docDeathCert', 'Death Certificate / Confirmation Letter / medical documents (if relevant)', 'select', false, 'If relevant', 'Required Claim Documents', 'Provided,Not provided,N/A'),
  f('docRelationship', 'NRC / passport / birth / marriage certificate proving relationship to beneficiary', 'select', false, 'Required document', 'Required Claim Documents', 'Provided,Not provided,N/A'),
  f('docRecommendation', 'Recommendation letter of specialist doctor / ward-in-charge professor', 'select', false, 'Required document', 'Required Claim Documents', 'Provided,Not provided'),
  f('docBills', 'Original medical bills with original seals', 'select', false, 'Required document', 'Required Claim Documents', 'Provided,Not provided'),
  f('docClaimantId', 'NRC / Passport of Claimant', 'select', false, 'Required document', 'Required Claim Documents', 'Provided,Not provided'),
  f('docOther', 'Any other supportive documents', 'select', false, 'Optional', 'Required Claim Documents', 'Provided,Not provided,N/A'),
]

const DAIICHI_LOG: InsurerField[] = [
  f('fullName', "Life Insured's Full Name (as in NRC)", 'text', true, '', "Life Insured's Details"),
  f('policyNo', 'Policy Number', 'text', true, '', "Life Insured's Details"),
  f('nrc', 'NRC Number or Passport Number', 'text', false, '', "Life Insured's Details"),
  f('dob', 'Date of Birth', 'date', false, 'DD/MM/YY', "Life Insured's Details"),
  f('phone', 'Contact Phone Number', 'text', false, '', "Life Insured's Details"),
  f('email', 'Contact Email Address', 'text', false, '', "Life Insured's Details"),
  f('hospital', 'Hospital Name', 'text', true, '', 'Visit Details'),
  f('doctor', 'Doctor Name', 'text', false, '', 'Visit Details'),
  f('visitType', 'Type of Visit', 'select', false, 'Inpatient / Outpatient / Day Care', 'Visit Details', 'Inpatient,Outpatient,Day Care'),
  f('appointmentDate', 'Admission or Appointment Date', 'date', true, 'DD/MM/YY', 'Visit Details'),
  f('diagnosis', 'Diagnosis or Presenting Symptoms', 'textarea', false, '', 'Visit Details'),
  f('briefCondition', 'Brief medical condition', 'textarea', false, 'Symptom start date, duration of symptoms, past medical history', 'Visit Details'),
  f('stayLength', 'Length of hospital stay if In-patient (optional)', 'text', false, 'Optional — only for in-patient', 'Visit Details'),
  f('estimatedCost', 'Estimated cost if In-patient (optional)', 'amount', false, 'Optional — only for in-patient', 'Visit Details'),
]

export const DEFAULT_INSURERS: InsurerConfig[] = [
  { id: 'aya', name: 'AYA Sompo', forms: { claim: AYA_CLAIM, log: AYA_LOG } },
  { id: 'mgen', name: 'MGEN', forms: { claim: MGEN_CLAIM, log: MGEN_LOG } },
  { id: 'ami', name: 'AMI Life Insurance', forms: { log: AMI_LOG } },   // LOG only — no claim form
  { id: 'daiichi', name: 'Daiichi Life', forms: { claim: DAIICHI_CLAIM, log: DAIICHI_LOG } },
  { id: 'mi', name: 'Myanma Insurance', forms: { claim: [], log: [] } },
  { id: 'kbz', name: 'KBZ Life', forms: { claim: [], log: [] } },
]
