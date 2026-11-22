import React, { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Text, View } from 'react-native';
import * as Sharing from 'expo-sharing';
import { File } from 'expo-file-system';
import { listRecordings, RecordingFile } from '../../storage/files';
import { Button, Card, styles } from '../components';
import { useSession } from '../hooks';
import { space } from '../theme';
import { bytes } from '../words';

export function FilesScreen() {
  const s = useSession();
  const [files, setFiles] = useState<RecordingFile[]>([]);
  const refresh = useCallback(() => {
    try {
      setFiles(listRecordings());
    } catch {
      setFiles([]);
    }
  }, []);
  // Refresh after downloads and phone recordings finish.
  useEffect(refresh, [refresh, s.download.phase, s.phoneRecording.active]);

  const share = async (f: RecordingFile) => {
    const csv = f.name.endsWith('.csv');
    await Sharing.shareAsync(f.uri, csv ? { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text' } : { UTI: 'public.data' });
  };
  const remove = (f: RecordingFile) =>
    Alert.alert('Delete file', `Delete ${f.name} from this phone? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          new File(f.uri).delete();
          refresh();
        },
      },
    ]);

  return (
    <FlatList
      contentContainerStyle={{ padding: space.m }}
      data={files}
      keyExtractor={(f) => f.uri}
      onRefresh={refresh}
      refreshing={false}
      ListHeaderComponent={
        <Text style={[styles.note, { marginBottom: space.m }]}>
          Downloads and phone recordings. They are also in the Files app under On My iPhone, AusculPatch, recordings. The .bin file is the raw flash image; the .csv opens in the desktop workbench.
        </Text>
      }
      ListEmptyComponent={<Text style={styles.note}>No recordings yet.</Text>}
      renderItem={({ item }) => (
        <Card>
          <Text style={[styles.body, { fontWeight: '600' }]}>{item.name}</Text>
          <Text style={styles.note}>{`${bytes(item.size)}, ${new Date(item.modified).toLocaleString()}`}</Text>
          <View style={styles.buttonRow}>
            <Button label="Share" kind="primary" onPress={() => share(item)} />
            <Button label="Delete" kind="danger" onPress={() => remove(item)} />
          </View>
        </Card>
      )}
    />
  );
}
