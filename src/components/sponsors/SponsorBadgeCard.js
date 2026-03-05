export function sponsorInitials(name = '') {
  return String(name).split(' ').map(part => part.trim()[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'SP';
}

export function SponsorBadgeCard({ sponsor, message = '' }) {
  if (!sponsor) return '';
  const text = message || sponsor.tagline || '';
  return { sponsor, text, initials: sponsorInitials(sponsor.name) };
}
