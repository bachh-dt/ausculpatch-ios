/**
 * App-wide singletons that need native modules: settings on disk, the history
 * database, and fall notifications.
 */
import { File, Paths } from 'expo-file-system';
import * as Notifications from 'expo-notifications';
import { SettingsStore } from '../settings/settings';
import { History } from '../history/historyDb';

const settingsFile = () => new File(Paths.document, 'settings.json');

export const settings = new SettingsStore({
  load: () => {
    const f = settingsFile();
    return f.exists ? f.textSync() : null;
  },
  save: (text) => {
    const f = settingsFile();
    if (!f.exists) f.create();
    f.writeSync(text);
  },
});

export const history = new History();
history.startAutoFlush();

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function ensureNotificationPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const asked = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowSound: true, allowBadge: false },
  });
  return asked.granted;
}

export async function notifyFall(timeText: string): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Possible fall detected',
        body: `At ${timeText}. Tap to review. Nobody has been contacted.`,
        sound: 'default',
        interruptionLevel: 'timeSensitive',
      },
      trigger: null,
    });
  } catch {
    // The in-app alert still shows.
  }
}

export async function notifyReattach(): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title: 'Check the patch', body: 'The signals are too weak to read. Press the patch firmly onto the chest.' },
      trigger: null,
    });
  } catch {
    // The in-app sheet still shows.
  }
}
