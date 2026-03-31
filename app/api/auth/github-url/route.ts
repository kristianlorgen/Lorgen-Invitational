import { fail } from '@/lib/apiResponse';

export async function GET() {
  return fail('GitHub-innlogging er ikke konfigurert i dette miljøet', 501);
}
