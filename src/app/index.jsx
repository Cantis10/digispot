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
      <ScrollView>
        <QrCode passcode={100} />
        <Text>I am working? yes.</Text>
        <Text>Value: {value}</Text>
        <View>
          <Text>Folder Display</Text>
        </View>
        <Folder />
        <ClientList />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "red",
    backgroundColor: "white",
  },
});
