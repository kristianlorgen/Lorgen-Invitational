const getRequiredEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

const getOptionalEnv = (key: string, fallback = ''): string => {
  return process.env[key] ?? fallback;
};

export const env = {
  get supabaseUrl() {
    return getRequiredEnv('NEXT_PUBLIC_SUPABASE_URL');
  },
  get supabaseAnonKey() {
    return getRequiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  },
  get supabaseServiceRoleKey() {
    return getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY');
  },
  get sessionSecret() {
    return getRequiredEnv('SESSION_SECRET');
  },
  get siteUrl() {
    return getRequiredEnv('SITE_URL');
  },
  get adminPassword() {
    return getOptionalEnv('ADMIN_PASSWORD');
  }
};
