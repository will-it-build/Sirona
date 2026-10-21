// User-scoped offline queue. Acknowledged server revisions are never guessed.
export class RecordStore {
  constructor(user, storage, request, changed = () => {}) {
    this.user = user;
    this.storage = storage;
    this.request = request;
    this.changed = changed;
    this.cacheKey = 'sirona-v2:' + user.id;
    this.base = {};
    this.pending = {};
    this.conflicts = {};
    this.busy = false;
    this.active = true;
    this.error = '';
    const cached = JSON.parse(storage.getItem(this.cacheKey) || '{}');
    this.base = cached.base || {};
    this.pending = cached.pending || {};
    this.conflicts = cached.conflicts || {};
  }
  persist() {
    if (this.inTransaction) return;
    try {
      this.storage.setItem(this.cacheKey, JSON.stringify({ base: this.base, pending: this.pending, conflicts: this.conflicts }));
    } catch {
      this.error = 'Device storage is full or unavailable. Keep this page open and export your workouts.';
      this.changed();
      throw new Error(this.error);
    }
    this.changed();
  }
  transaction(update) {
    this.inTransaction = true;
    try { update(); }
    finally { this.inTransaction = false; this.persist(); }
  }
  get(key) {
    const r = this.pending[key] || this.base[key];
    return !r || r.deleted ? null : structuredClone(r.data);
  }
  sessions() {
    return [...new Set([...Object.keys(this.base), ...Object.keys(this.pending)])]
      .filter(key => key.startsWith('session:')).map(key => this.get(key)).filter(Boolean)
      .sort((a, b) => b.date.localeCompare(a.date));
  }
  put(key, data, deleted = false) {
    if (!this.active) throw new Error('This account is no longer active.');
    if (JSON.stringify(this.get(key)) === JSON.stringify(deleted ? null : data)) return;
    this.pending[key] = { data: deleted ? null : structuredClone(data), deleted,
      revision: this.pending[key]?.revision ?? this.base[key]?.revision ?? 0, mutationId: crypto.randomUUID() };
    this.persist();
  }
  accept(key, sent, result) {
    this.base[key] = result;
    if (this.pending[key]?.mutationId === sent.mutationId) delete this.pending[key];
    else if (this.pending[key]) this.pending[key].revision = result.revision;
    delete this.conflicts[key];
    this.persist();
  }
  async sync() {
    if (this.busy || !this.active) return;
    this.busy = true;
    this.error = '';
    this.changed();
    try {
      for (const key of Object.keys(this.pending)) {
        if (!this.active) return;
        if (this.conflicts[key]) continue;
        const sent = structuredClone(this.pending[key]);
        try {
          const result = await this.request('/api/v2/records/' + encodeURIComponent(key), 'PUT', sent);
          if (!this.active) return;
          this.accept(key, sent, result.record);
        } catch (error) {
          if (!this.active) return;
          if (error.status === 409 && error.data?.conflict) {
            this.conflicts[key] = { remote: error.data.record };
            if (error.data.record) this.base[key] = error.data.record;
            this.persist();
          } else throw error;
        }
      }
      let after = '';
      do {
        const response = await this.request('/api/v2/records' + (after ? '?after=' + encodeURIComponent(after) : ''), 'GET');
        if (!this.active) return;
        for (const remote of response.records) {
          const key = remote.key, pending = this.pending[key];
          if (pending && pending.mutationId === remote.mutationId) {
            this.accept(key, pending, remote);
          } else {
            this.base[key] = remote;
            if (pending && pending.revision !== remote.revision) this.conflicts[key] = { remote };
          }
        }
        after = response.next;
      } while (after);
      this.persist();
    } catch (error) {
      if (this.active) this.error = error.message || 'Cannot reach the server. Changes remain on this device.';
    } finally {
      this.busy = false;
      if (this.active) this.changed();
    }
  }
  resolve(key, choice) {
    const conflict = this.conflicts[key];
    if (!conflict) return;
    const local = this.pending[key], remote = conflict.remote;
    if (choice === 'server') delete this.pending[key];
    else if (remote?.deleted && !local.deleted) {
      // Restoring a deleted session always creates a new identity, deliberately.
      const data = structuredClone(local.data);
      data.id = crypto.randomUUID();
      delete this.pending[key];
      this.put('session:' + data.id, data);
    } else if (remote?.deleted && local.deleted) delete this.pending[key];
    else this.pending[key] = { ...local, revision: remote?.revision || 0, mutationId: crypto.randomUUID() };
    delete this.conflicts[key];
    this.persist();
  }
}
