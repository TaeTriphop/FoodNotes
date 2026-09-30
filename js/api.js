import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

let client = null;

export function isConfigured() {
  return !SUPABASE_URL.includes("YOUR_") && !SUPABASE_KEY.includes("YOUR_");
}

function db() {
  if (!client) client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  return client;
}

export async function loadAll() {
  const [r, d] = await Promise.all([
    db().from("restaurants").select("*"),
    db().from("dishes").select("*"),
  ]);
  if (r.error) throw r.error;
  if (d.error) throw d.error;
  return { restaurants: r.data, dishes: d.data };
}

async function save(table, payload, id) {
  const query = id
    ? db().from(table).update(payload).eq("id", id)
    : db().from(table).insert(payload);
  const { data, error } = await query.select().single();
  if (error) throw error;
  return data;
}

async function remove(table, id) {
  const { error } = await db().from(table).delete().eq("id", id);
  if (error) throw error;
  return true;
}

export const saveRestaurant = (payload, id) => save("restaurants", payload, id);
export const saveDish = (payload, id) => save("dishes", payload, id);
export const deleteRestaurant = (id) => remove("restaurants", id);
export const deleteDish = (id) => remove("dishes", id);
