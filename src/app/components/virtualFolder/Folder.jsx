// App.jsx — example entry point
import { StyleSheet, View } from "react-native";
import FolderExplorer from "./FolderExplorer";
import { FolderProvider } from "./FolderStore";

export default function Folder() {
  return (
    <View style={styles.safeArea}>
      <FolderProvider>
        <FolderExplorer />
      </FolderProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#F7F8FA" },
});
