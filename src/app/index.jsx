import { useContext } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import ClientList from "./components/clientList";
import Folder from "./components/virtualFolder/Folder";
import QrCode from "./qrcode";
import { AppContext } from "./values/appContext";
export default function Index() {
  const { value, setValue } = useContext(AppContext);
  return (
    <View style={styles.container}>
      <View style={styles.navbar}>
        <Text style={styles.logo}>DigiSpot</Text>
      </View>
      <ScrollView>
        <View style={styles.pageContent}>
          <View style={styles.qrCard}>
            <QrCode />
          </View>
          <View style={styles.statusCard}>
            <Text style={styles.statusTitle}>Application status</Text>
            <Text style={styles.statusText}>I am working? yes.</Text>
            <Text style={styles.statusText}>Value: {value}</Text>
          </View>
          <View style={styles.folderSection}>
            <Text style={styles.sectionTitle}>Folder Display</Text>
            <Folder />
          </View>
          <View style={styles.clientSection}>
            <ClientList />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#E0E0E0" },
  navbar: {
    height: 64,
    justifyContent: "center",
    paddingHorizontal: 20,
    backgroundColor: "#5DBBFF",
    elevation: 3,
    zIndex: 1,
  },
  logo: { color: "#FFFFFF", fontSize: 30, fontWeight: "600" },
  pageContent: {
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
    padding: 16,
    gap: 14,
  },
  qrCard: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#AAAAAA",
    borderRadius: 17,
    padding: 18,
    elevation: 3,
  },
  statusCard: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#AAAAAA",
    borderRadius: 14,
    padding: 16,
  },
  statusTitle: {
    color: "#333333",
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 6,
  },
  statusText: { color: "#666666", fontSize: 14, marginTop: 3 },
  folderSection: { gap: 8 },
  sectionTitle: { color: "#333333", fontSize: 18, fontWeight: "700" },
  clientSection: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#AAAAAA",
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
  },
});
