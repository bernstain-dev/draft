import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { confirmationHandler } from '../_shared/handlers.ts';
const env = (name: string) => Deno.env.get(name);
const options = { auth: { persistSession: false, autoRefreshToken: false } };
Deno.serve(confirmationHandler({ env,
  userClient: (authorization) => createClient(env('SUPABASE_URL')!, env('SUPABASE_ANON_KEY')!, { ...options, global: { headers: { Authorization: authorization } } }),
  serviceClient: () => createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!, options),
}));
