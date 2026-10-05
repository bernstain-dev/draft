import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { deliveryHandler } from '../_shared/delivery.ts';
Deno.serve(deliveryHandler(name => Deno.env.get(name), () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })));
