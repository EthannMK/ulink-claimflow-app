---
name: Ulink Assist Logic
colors:
  surface: '#f7f9fc'
  surface-dim: '#d8dadd'
  surface-bright: '#f7f9fc'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f4f7'
  surface-container: '#eceef1'
  surface-container-high: '#e6e8eb'
  surface-container-highest: '#e0e3e6'
  on-surface: '#191c1e'
  on-surface-variant: '#42474f'
  inverse-surface: '#2d3133'
  inverse-on-surface: '#eff1f4'
  outline: '#72777f'
  outline-variant: '#c2c7d0'
  surface-tint: '#35618d'
  primary: '#00375e'
  on-primary: '#ffffff'
  primary-container: '#1f4e79'
  on-primary-container: '#95bff1'
  inverse-primary: '#a0cafc'
  secondary: '#1f686a'
  on-secondary: '#ffffff'
  secondary-container: '#a8eced'
  on-secondary-container: '#256c6f'
  tertiary: '#4c2e00'
  on-tertiary: '#ffffff'
  tertiary-container: '#6a4300'
  on-tertiary-container: '#e9b268'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d1e4ff'
  primary-fixed-dim: '#a0cafc'
  on-primary-fixed: '#001d35'
  on-primary-fixed-variant: '#184974'
  secondary-fixed: '#abeef0'
  secondary-fixed-dim: '#8fd2d4'
  on-secondary-fixed: '#002021'
  on-secondary-fixed-variant: '#004f51'
  tertiary-fixed: '#ffddb5'
  tertiary-fixed-dim: '#f5bc72'
  on-tertiary-fixed: '#2a1800'
  on-tertiary-fixed-variant: '#643f00'
  background: '#f7f9fc'
  on-background: '#191c1e'
  surface-variant: '#e0e3e6'
  status-ai: '#1F4E79'
  status-approved: '#2D8A4E'
  status-pending: '#D97706'
  status-rejected: '#DC2626'
  brand-accent: '#ED5500'
  text-main: '#485867'
typography:
  display-lg:
    fontFamily: Hanken Grotesk
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Hanken Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  headline-sm:
    fontFamily: Hanken Grotesk
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  title-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
  headline-md-mobile:
    fontFamily: Hanken Grotesk
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  pane-gap: 16px
  container-padding: 24px
  sidebar-width: 260px
  inspector-width: 380px
---

## Brand & Style

The design system establishes a high-trust, authoritative environment for health insurance claim administrators. It balances the urgency of healthcare with the systematic precision of insurance fintech. The style is **Corporate Modern** with a focus on high information density, utilizing a multi-pane layout to minimize context switching for TPAs (Third Party Administrators).

The aesthetic is characterized by a "Clinical Precision" approach: clean white surfaces, systematic spacing, and subtle depth. By combining the deep corporate navy of the insurance sector with the soft teal accents found in the brand's digital presence, the system evokes reliability, technological advancement (AI), and professional calm.

## Colors

The palette is anchored by **Deep Navy (#1F4E79)**, representing the core administrative power and stability of the platform. **Teal (#84C7C9)** is used as a secondary accent for interactive elements and health-related highlights, bridging the gap between insurance and medical care. 

The background uses a cool **Light Neutral (#F5F7FA)** to reduce eye strain during long shifts, while **Pure White (#FFFFFF)** is reserved for the primary work containers (cards and panes). Status colors follow a strict semantic protocol:
- **AI-Driven:** Primary Navy, often paired with a subtle glow or icon.
- **Approved:** A professional forest green for clarity.
- **Pending:** High-visibility amber for items requiring attention.
- **Rejected/Fraud:** Urgent red to trigger immediate review.

## Typography

This design system uses **Hanken Grotesk** for headlines to provide a sharp, contemporary "tech-forward" feel that differentiates the AI-powered workspace from legacy insurance software. **Inter** is the workhorse for all body content and UI labels, chosen for its exceptional legibility in data-heavy tables and complex forms.

- **Headlines:** Use tight letter spacing and heavier weights to establish clear hierarchy.
- **Data Display:** Utilize `body-sm` for table rows to maximize information density without sacrificing readability.
- **Labels:** All-caps styling is reserved for `label-md` when used in category headers or metadata tags to create visual distinction from body text.

## Layout & Spacing

The system employs a **Multi-Pane Workspace** model. Instead of a standard fluid grid, it uses a functional split-screen approach to support the "omnichannel" nature of the work.

1.  **Sidebar:** Fixed at 260px for navigation and queue management.
2.  **Primary Canvas:** A fluid central area for the main data table or claim details.
3.  **Inspector Pane:** A collapsible 380px right-hand panel dedicated to AI insights, document previews, and chat history.

Spacing follows a 4px baseline. Gutters between major functional blocks are set to 16px to maintain a compact, "cockpit-like" feel while preventing visual clutter.

## Elevation & Depth

Hierarchy is primarily communicated through **Tonal Layering** and **Soft Shadows**. 

- **Level 0 (Background):** The Light Neutral (#F5F7FA) surface acting as the foundation.
- **Level 1 (Content Panes):** White surfaces with a 1px border (#E2E8F0) and no shadow, used for secondary information.
- **Level 2 (Active Cards):** White surfaces with a "Soft Ambient" shadow (0px 4px 12px rgba(31, 78, 121, 0.08)). This is used for the primary claim being processed.
- **Level 3 (Overlays):** Modals and dropdowns use a more pronounced shadow to indicate temporary focus.

AI-generated components may use a subtle inner-glow or a Primary Navy border to indicate that the content was not manually entered.

## Shapes

The design system utilizes **Rounded (0.5rem)** corners for standard UI elements like cards, buttons, and input fields. This softens the "industrial" feel of insurance software, making the workspace feel more approachable and modern.

- **Status Pills:** Use fully rounded (pill-shaped) geometry to distinguish them clearly from interactive buttons.
- **Form Inputs:** 0.5rem radius ensures consistency with primary action buttons.
- **Selection States:** Highlighted rows in tables use a 4px corner radius to maintain a precise, professional alignment.

## Components

### Tables
The core of the administrator's workflow. Tables should use a "Compact" vertical rhythm with 12px cell padding. Headers are `label-md` with a subtle gray background. Row hover states should use a 5% opacity of the Secondary Teal.

### Status Pills & Badges
- **AI Badges:** Use Primary Navy with a small spark icon.
- **Status Pills:** High-contrast text on a 10% opacity background of the semantic color (e.g., Green text on light green bg).

### Buttons
- **Primary:** Solid Deep Navy with white text.
- **Secondary:** Outlined Teal for less urgent actions.
- **Ghost:** Used for table actions to reduce visual noise.

### Multi-pane Workspaces
The workspace must support a "Dual-View." When a claim is selected from the list, the list should compress to a "Master" column, and the "Detail" pane should expand.

### Input Fields
Fields should have a 1px border. On focus, the border transitions to Primary Navy with a 2px soft outer glow. Support for "In-line validation" is mandatory, given the accuracy requirements of insurance claims.