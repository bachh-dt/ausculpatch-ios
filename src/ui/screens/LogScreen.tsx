import React, { useRef } from 'react';
import { ScrollView, ScrollViewInstance, Text } from 'react-native';
import { session } from '../../ble/session';
import { useSession } from '../hooks';
import { colors, space } from '../theme';

export function LogScreen() {
  useSession(); // re-render when a line arrives
  const ref = useRef<ScrollViewInstance>(null);
  return (
    <ScrollView
      ref={ref}
      contentContainerStyle={{ padding: space.m }}
      onContentSizeChange={() => ref.current?.scrollToEnd({ animated: false })}
    >
      <Text selectable style={{ color: colors.text, fontFamily: 'Menlo', fontSize: 11, lineHeight: 16 }}>
        {session.log.length ? session.log.join('\n') : 'Messages from the patch appear here.'}
      </Text>
    </ScrollView>
  );
}
