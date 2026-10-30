-- New workflow stages for the approval chains in the next migration. Enum values are added in a migration of their
-- own because Postgres can't use a new enum value in the same transaction that adds it.

-- Member files: Officer ──▶ Marketer ──▶ Officer ──▶ Branch Manager
alter type public.member_status add value if not exists 'with_marketer' after 'draft';
alter type public.member_status add value if not exists 'marketer_reviewed' after 'with_marketer';

-- Loans: Head of Credit ──▶ Head of Business ──▶ Accounts
alter type public.loan_status add value if not exists 'credit_approved' after 'appraised';
