import type { RequestDecision } from "@telar/engine-client";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { RequestCard } from "./requests";

type Props = { cards: RequestCard[]; deciding?: string; onDecide: (requestId: string, decision: RequestDecision) => void };

const BUTTONS: { decision: RequestDecision; label: string }[] = [
  { decision: "accept", label: "Approve" },
  { decision: "acceptForSession", label: "Always allow" },
  { decision: "decline", label: "Decline" },
];

export function RequestCards({ cards, deciding, onDecide }: Props) {
  return (
    <>
      {cards.map((card) => (
        <View key={card.id} style={styles.card}>
          <Text style={styles.title}>{card.title}</Text>
          {card.body ? (
            <ScrollView horizontal={card.mono} style={styles.bodyBox}>
              <Text style={[styles.body, card.mono && styles.mono]} numberOfLines={card.mono ? 8 : undefined}>
                {card.body}
              </Text>
            </ScrollView>
          ) : null}
          {card.decidable ? (
            <View style={styles.buttons}>
              {BUTTONS.map(({ decision, label }) => (
                <Pressable
                  key={decision}
                  accessibilityRole="button"
                  disabled={deciding === card.id}
                  onPress={() => onDecide(card.id, decision)}
                  style={[styles.button, decision === "accept" && styles.primary]}
                >
                  <Text style={[styles.buttonLabel, decision === "accept" && styles.primaryLabel]}>{label}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 10, marginBottom: 8, padding: 12, gap: 8, borderRadius: 14, backgroundColor: "#FFF4E0", borderWidth: 1, borderColor: "#F5C26B" },
  title: { fontSize: 15, fontWeight: "600", color: "#1C1C1E" },
  bodyBox: { maxHeight: 160 },
  body: { fontSize: 13, color: "#3A3A3C" },
  mono: { fontFamily: "Menlo" },
  buttons: { flexDirection: "row", gap: 8 },
  button: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, backgroundColor: "white" },
  primary: { backgroundColor: "#0A84FF" },
  buttonLabel: { fontSize: 14, fontWeight: "600", color: "#0A84FF" },
  primaryLabel: { color: "white" },
});
