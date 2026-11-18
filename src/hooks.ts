import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { uppercaseNames, type Row } from './model';
export function useRows(path: string, enabled = true, owner?: string) {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(Boolean(db && enabled));
  useEffect(() => {
    setRows([]);
    setError('');
    setLoading(Boolean(db && enabled));
    if (!db || !enabled) return;
    const source = owner
      ? query(collection(db, path), where('submittedByUid', '==', owner))
      : collection(db, path);
    return onSnapshot(
      source,
      (s) => {
        setRows(s.docs.map((d) => uppercaseNames({ ...d.data(), id: d.id })));
        setLoading(false);
      },
      (e) => {
        setRows([]);
        setError(e.message);
        setLoading(false);
      },
    );
  }, [path, enabled, owner]);
  return { rows: enabled ? rows : [], loading, error };
}

export function usePhoto(path: string, id?: string) {
  const [value, setValue] = useState<{ key: string; photo: string }>({ key: '', photo: '' });
  const key = `${path}/${id || ''}`;
  useEffect(() => {
    if (!db || !id) return;
    return onSnapshot(
      doc(db, path, id),
      (s) => setValue({ key, photo: s.data()?.dataUrl || '' }),
      () => setValue({ key, photo: '' }),
    );
  }, [path, id, key]);
  return value.key === key ? value.photo : '';
}
