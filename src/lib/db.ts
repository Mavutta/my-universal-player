import Dexie, { Table } from 'dexie';
import { Track, Playlist } from './types';

export class SonicDB extends Dexie {
  tracks!: Table<Track>;
  playlists!: Table<Playlist>;

  constructor() {
    super('SonicDB');
    this.version(2).stores({
      tracks: '++id, title, artist, album, genre, path, isFavorite',
      playlists: '++id, name, createdAt'
    });
  }
}

export const db = new SonicDB();
