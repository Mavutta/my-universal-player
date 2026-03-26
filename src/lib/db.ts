import Dexie, { Table } from 'dexie';
import { Track, Playlist } from './types';

export class SonicDB extends Dexie {
  tracks!: Table<Track>;
  playlists!: Table<Playlist>;
  metadata!: Table<{ key: string, value: any }>;

  constructor() {
    super('SonicDB');
    this.version(3).stores({
      tracks: '++id, title, artist, album, genre, path, isFavorite',
      playlists: '++id, name, createdAt',
      metadata: 'key'
    });
  }
}

export const db = new SonicDB();
