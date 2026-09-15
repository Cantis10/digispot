import Webhost from "./_webhost";
import Root from "./root";
import { AppProvider } from "./values/appContext";
export default function RootLayout() {
  return (
    <>
      <Webhost />
      <AppProvider>
        <Root />
      </AppProvider>
    </>
  );
}
