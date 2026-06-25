'use strict';
const { queryAll, queryOne, run } = require('./store');

function generateTicket() {
  const n = new Date();
  const y = String(n.getFullYear()).slice(-2);
  const m = String(n.getMonth() + 1).padStart(2, '0');
  const d = String(n.getDate()).padStart(2, '0');
  return `TK${y}${m}${d}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
}

function allClients(search) {
  const q = search ? `%${search}%` : '%';
  return queryAll(`
    SELECT c.id, c.name, c.phone, c.email,
      (SELECT COUNT(*) FROM repairs r WHERE r.client_id = c.id) AS repair_count,
      (SELECT status FROM repairs r WHERE r.client_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_status,
      (SELECT ticket FROM repairs r WHERE r.client_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_ticket,
      (SELECT model FROM repairs r WHERE r.client_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_model
    FROM clients c
    WHERE c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ?
    ORDER BY c.id DESC LIMIT 300`, [q, q, q]);
}

function getClient(id) { return queryOne('SELECT * FROM clients WHERE id=?', [id]); }

function upsertClient(data) {
  if (data.id) {
    run('UPDATE clients SET name=?,phone=?,email=?,address=?,notes=? WHERE id=?',
      [data.name, data.phone||'', data.email||'', data.address||'', data.notes||'', data.id]);
    return { ok: true, id: Number(data.id) };
  }
  run('INSERT INTO clients (name,phone,email,address,notes) VALUES (?,?,?,?,?)',
    [data.name, data.phone||'', data.email||'', data.address||'', data.notes||'']);
  const row = queryOne('SELECT id FROM clients WHERE name=? ORDER BY id DESC LIMIT 1', [data.name]);
  return { ok: true, id: row ? row.id : null };
}

function deleteClient(id) {
  run('DELETE FROM repairs WHERE client_id=?', [id]);
  run('DELETE FROM clients WHERE id=?', [id]);
  return { ok: true };
}

function getRepairs(clientId) {
  return queryAll('SELECT * FROM repairs WHERE client_id=? ORDER BY created_at DESC', [clientId]);
}

function getRepair(id) { return queryOne('SELECT * FROM repairs WHERE id=?', [id]); }

function upsertRepair(data) {
  const now = Math.floor(Date.now() / 1000);
  if (data.id) {
    run(`UPDATE repairs SET device=?,brand=?,model=?,imei=?,color=?,issue=?,diagnosis=?,solution=?,
      status=?,price=?,deposit=?,warranty_days=?,updated_at=?,delivered_at=? WHERE id=?`,
      [data.device||'', data.brand||'', data.model||'', data.imei||'', data.color||'',
       data.issue||'', data.diagnosis||'', data.solution||'', data.status||'pending',
       Number(data.price)||0, Number(data.deposit)||0, Number(data.warranty_days)||90, now,
       data.status === 'delivered' ? now : (data.delivered_at || null), Number(data.id)]);
    return { ok: true, id: Number(data.id), ticket: data.ticket };
  }
  const ticket = generateTicket();
  run(`INSERT INTO repairs (client_id,ticket,device,brand,model,imei,color,issue,status,price,deposit,warranty_days)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [data.client_id, ticket, data.device||'', data.brand||'', data.model||'', data.imei||'',
     data.color||'', data.issue||'', data.status||'pending',
     Number(data.price)||0, Number(data.deposit)||0, Number(data.warranty_days)||90]);
  const row = queryOne('SELECT id FROM repairs WHERE ticket=?', [ticket]);
  return { ok: true, id: row ? row.id : null, ticket };
}

function repairStats() {
  const byStatus = queryAll('SELECT status, COUNT(*) as n FROM repairs GROUP BY status');
  const byBrand  = queryAll('SELECT brand, COUNT(*) as n FROM repairs WHERE brand != "" GROUP BY brand ORDER BY n DESC LIMIT 10');
  const rev = queryOne('SELECT SUM(price) as total FROM repairs WHERE status="delivered"');
  const total = queryOne('SELECT COUNT(*) as n FROM repairs');
  return { byStatus, byBrand, revenue: (rev && rev.total) || 0, total: (total && total.n) || 0 };
}

module.exports = { generateTicket, allClients, getClient, upsertClient, deleteClient, getRepairs, getRepair, upsertRepair, repairStats };
