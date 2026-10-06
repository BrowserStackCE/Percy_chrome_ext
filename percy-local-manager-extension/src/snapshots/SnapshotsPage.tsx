import { useEffect, useState } from 'react';
import {
  deleteSnapshot,
  getSnapshots,
  getLibraryToken,
} from '../services/backendApi';
import { SnapshotRow } from '../components/SnapshotRow';
import { FinalizeBuildPanel } from '../components/FinalizeBuildPanel';
import { ClearSnapshotsButton } from '../components/ClearSnapshotsButton';
import { BrandMark } from '../components/BrandMark';
import type { Snapshot } from '../types';
import { EditSnapshotPanel } from '../components/EditSnapshotPanel';

export function SnapshotsPage() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingSnapshot, setEditingSnapshot] = useState<Snapshot | null>(null);

  async function refresh() {
    setLoading(true);

    try {
      const data = await getSnapshots();
      setSnapshots(data);
    } catch (error) {
      console.error('Failed to load snapshots:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);

    try {
      await deleteSnapshot(id);

      setSnapshots((current) =>
        current.filter((snapshot) => snapshot.id !== id)
      );
    } catch (error) {
      console.error('Failed to delete snapshot:', error);
    } finally {
      setDeletingId(null);
    }
  }

  useEffect(() => {
    refresh();
    getLibraryToken()
      .then((t) => setToken(t))
      .catch(() => {/* backend offline — token stays empty */});
  }, []);

  return (
    <>
      <div className="topbar">
        <div className="topbar__inner">
          <div className="topbar__brand">
            <BrandMark  />

            <div className="topbar__brand-text">
              <span className="topbar__title">Percy</span>
              <span className="topbar__subtitle">
                Local Manager
              </span>
            </div>
          </div>
        </div>
      </div>

      <div
        className="topbar__accent-strip"
        aria-hidden="true"
      />

      <main className="snapshots-page">
        <div className="page-header">
          <div>
            <h1>Snapshot Queue</h1>
            <p>
              Review what's captured before you finalize a Percy build.
            </p>
          </div>

          <div className="stat-pill">
            <span className="stat-pill__value">
              {loading ? '—' : snapshots.length}
            </span>

            <span className="stat-pill__label">
              Queued
            </span>
          </div>
        </div>

        {loading && (
          <div className="loading-state">
            Loading snapshots…
          </div>
        )}

        {!loading && snapshots.length === 0 && (
          <div className="empty-state">
            No snapshots queued yet. Capture one from the extension
            popup to get started.
          </div>
        )}

        {!loading && snapshots.length > 0 && (
          <div className="table-wrap">
            <table className="snapshot-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>URL</th>
                  <th>Widths</th>
                  <th>Min Height</th>
                  <th>Options</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {snapshots.map((snapshot) => (
                  <SnapshotRow
                    key={snapshot.id}
                    snapshot={snapshot}
                    deleting={deletingId === snapshot.id}
                    onDelete={handleDelete}
                    onEdit={setEditingSnapshot}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="page-actions">
          <ClearSnapshotsButton
            disabled={snapshots.length === 0}
            onCleared={refresh}
          />

          <FinalizeBuildPanel
            token={token}
            disabled={
              snapshots.length === 0 ||
              token.trim() === ''
            }
            onFinalized={refresh}
          />
        </div>
      </main>
      {editingSnapshot && (
        <EditSnapshotPanel
          snapshot={editingSnapshot}
          onClose={() => setEditingSnapshot(null)}
          onSaved={(updatedSnapshot) => {
            setSnapshots((current) =>
              current.map((snapshot) =>
                snapshot.id === updatedSnapshot.id
                  ? updatedSnapshot
                  : snapshot
              )
            );
          }}
        />
      )}
    </>
  );
}