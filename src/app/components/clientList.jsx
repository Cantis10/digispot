import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { getClients } from "../../../server/server";

export default function ClientList() {
  const [clients, setClients] = useState([]);

  useEffect(() => {
    const interval = setInterval(() => {
      const data = getClients();

      setClients(data);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Connected devices</Text>
      <View style={styles.list}>
        {clients.length > 0 ? (
          clients.map((client, index) => <Text style={styles.client} key={index}>{client.name}</Text>)
        ) : (
          <Text style={styles.empty}>No clients available.</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8 },
  title: { color: "#333333", fontSize: 16, fontWeight: "700" },
  list: { gap: 6 },
  client: { color: "#444444", fontSize: 14, paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#AAAAAA" },
  empty: { color: "#777777", fontSize: 14 },
});
