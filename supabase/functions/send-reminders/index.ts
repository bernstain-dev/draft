import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { reminderHandler } from '../_shared/handlers.ts';
Deno.serve(reminderHandler({ env: (name) => Deno.env.get(name),
  userClient: () => { throw new Error('Scheduler does not accept browser identity.'); },
  serviceClient: () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } }),
}));
