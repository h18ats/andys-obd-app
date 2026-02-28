import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.andybatty.obdapp',
  appName: "Andy's OBD App",
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
