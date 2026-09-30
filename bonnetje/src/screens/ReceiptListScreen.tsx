import React, { useLayoutEffect, useState } from "react";
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl, Alert } from "react-native";
import { ScreenProps } from "../navigation";
import { useAppData } from "../context";
import { getReceipt, describeError, hasUnsentChanges, deleteScannedReceipt } from "../api";
import { Receipt, Invoice } from "../types";
import { PersonName } from "../constants";
import { colors } from "../theme";
import ReceiptCard from "../components/ReceiptCard";
import BalanceCard from "../components/BalanceCard";
import PaymentSheet from "../components/PaymentSheet";
import HeaderMenu, { HamburgerIcon, headerButtonStyle } from "../components/HeaderMenu";
import HiddenSheet from "../components/HiddenSheet";
import SwipeableRow from "../components/SwipeableRow";
import ScanSheet from "../components/ScanSheet";
import ConfirmDialog from "../components/ConfirmDialog";
import InvoiceSheet from "../components/InvoiceSheet";
import InvoicesSheet from "../components/InvoicesSheet";
import { AddPersonSheet, PersonSheet } from "../components/PeopleSheets";
import { AhBanner, Banner, ListTab, PeopleLegend, ReceiptTabs } from "../components/ListHeader";
import { AddFab, SelectBar } from "../components/ListActions";
import { useFinishReceipt } from "../hooks/useFinishReceipt";
import { useMarkAllPaid } from "../hooks/useMarkAllPaid";
import { useReceiptFeed } from "../hooks/useReceiptFeed";
import { useSelection } from "../hooks/useSelection";
import { reserveNumber, withoutReservation } from "../utils/invoice";
import { removeReceipt } from "../utils/receipts";
import { baseDiscountMap, applyOverrides } from "../utils/discounts";

/** The one sheet that is open on this screen, if any. */
type Sheet = "menu" | "invoices" | "hidden" | "scan" | "add" | "pay" | "switch" | null;

export default function ReceiptListScreen({ navigation }: ScreenProps<"List">) {
  const { data, persistData, setReceipts, disconnect } = useAppData();
  const { receipts, ahError, ahCachedAt, refreshing, refresh } = useReceiptFeed();
  const selection = useSelection<string>();

  const [tab, setTab] = useState<ListTab>("open");
  const [sheet, setSheet] = useState<Sheet>(null);
  // Kept after the payment sheet closes, so its text does not empty while it fades out.
  const [payTarget, setPayTarget] = useState<{ person: PersonName | ""; amount: number }>({ person: "", amount: 0 });
  const [personShown, setPersonShown] = useState<PersonName | null>(null);
  const [invoiceShown, setInvoiceShown] = useState<Invoice | null>(null);
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const markAllPaid = useMarkAllPaid(setInvoiceShown);

  const { finish, finishMany, dialog: finishDialog } = useFinishReceipt({
    data,
    persistData,
    // The list has no products in memory, so fetch them and price them like the receipt page does.
    loadPricing: async (id) => {
      const detail = await getReceipt(id);
      if (!detail) throw new Error("not found");
      const base = baseDiscountMap(detail.products, detail.discounts || []);
      const priced = applyOverrides(detail.products, base.productDiscounts, base.unmatched, data.discountOverrides?.[id] || {});
      return { products: detail.products, discountMap: priced.map, unmatched: priced.unmatched };
    },
    onError: (e) => setNotice(`Afronden lukte niet: ${describeError(e)}`),
  });

  useLayoutEffect(() => {
    navigation.setOptions({
      title: selection.active ? (selection.selected.size > 0 ? `${selection.selected.size} geselecteerd` : "Kies bonnetjes") : "Bonnetjes",
      headerRight: () =>
        selection.active ? (
          <Pressable onPress={selection.stop} hitSlop={10} style={headerButtonStyle}>
            <Text style={{ color: colors.accent, fontSize: 16, fontWeight: "600" }}>Annuleren</Text>
          </Pressable>
        ) : (
          <Pressable accessibilityLabel="Menu" onPress={() => setSheet("menu")} hitSlop={10} style={headerButtonStyle}>
            <HamburgerIcon />
          </Pressable>
        ),
    });
  }, [navigation, selection.active, selection.selected.size, selection.stop]);

  const shown = receipts.filter((r) => !data.hidden.includes(r.id));
  const open = shown.filter((r) => !data.completed.includes(r.id));
  const done = shown.filter((r) => data.completed.includes(r.id));
  const list = tab === "open" ? open : done;

  const hide = (ids: string[]) => persistData({ ...data, hidden: [...new Set([...data.hidden, ...ids])] });

  /** Deletes hidden scanned receipts on the server first; only what is really gone leaves the app data. */
  async function deleteHidden(ids: string[]) {
    const results = await Promise.allSettled(ids.map(deleteScannedReceipt));
    const gone = ids.filter((_, i) => results[i].status === "fulfilled");
    if (gone.length > 0) {
      persistData((cur) => gone.reduce(removeReceipt, cur));
      setReceipts(receipts.filter((r) => !gone.includes(r.id)));
    }
    const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed) Alert.alert("Verwijderen mislukt", describeError(failed.reason));
  }

  const openReceipt = (id: string) => navigation.navigate("Detail", { receiptId: id });

  function handleScanned(receipt: Receipt) {
    setReceipts([receipt, ...receipts.filter((r) => r.id !== receipt.id)]);
    setSheet(null);
    openReceipt(receipt.id);
  }

  const header = (
    <View>
      {notice !== "" && <Banner text={notice} onPress={() => setNotice("")} />}
      <AhBanner error={ahError} cachedAt={ahCachedAt} />
      <PeopleLegend people={data.people} onPerson={setPersonShown} onAdd={() => setSheet("add")} />
      <BalanceCard
        data={data}
        onPayPress={(person, amount) => {
          setPayTarget({ person, amount });
          persistData(reserveNumber(data, person, new Date()));
          setSheet("pay");
        }}
        onPaidPress={markAllPaid}
      />
      <ReceiptTabs tab={tab} onChange={setTab} counts={{ open: open.length, done: done.length }} />
    </View>
  );

  return (
    <View style={s.container}>
      <FlatList
        data={list}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <Text style={s.empty}>
            {tab === "open"
              ? "Alles verdeeld. Trek omlaag om nieuwe bonnetjes op te halen."
              : "Afgeronde bonnetjes komen hier te staan."}
          </Text>
        }
        renderItem={({ item }) => (
          <SwipeableRow
            disabled={selection.active}
            open={openRowId === item.id}
            onOpenChange={(isOpen) => setOpenRowId(isOpen ? item.id : (id) => (id === item.id ? null : id))}
            actions={[
              ...(tab === "open"
                ? [{ label: "Afronden", glyph: "✓", background: colors.good, color: "#0A2A18", onPress: () => finish(item.id) }]
                : []),
              { label: "Verbergen", glyph: "✕", background: colors.bad, color: "#3A0F0B", onPress: () => hide([item.id]) },
            ]}
          >
            <ReceiptCard
              receipt={item}
              data={data}
              selectable={selection.active}
              selected={selection.selected.has(item.id)}
              onPress={() => (selection.active ? selection.toggle(item.id) : openReceipt(item.id))}
            />
          </SwipeableRow>
        )}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.sub} />}
        contentContainerStyle={{ padding: 16, paddingBottom: 110 }}
      />

      {selection.active ? (
        <SelectBar
          count={selection.selected.size}
          total={list.length}
          tab={tab}
          onToggleAll={() => selection.setAll(selection.selected.size === list.length ? [] : list.map((r) => r.id))}
          onFinish={() => {
            finishMany([...selection.selected]);
            selection.stop();
          }}
          onHide={() => {
            hide([...selection.selected]);
            selection.stop();
          }}
        />
      ) : (
        <AddFab onPress={() => setSheet("scan")} />
      )}

      {finishDialog}

      <HeaderMenu
        visible={sheet === "menu"}
        onClose={() => setSheet(null)}
        items={[
          { label: "Selecteren", onPress: selection.start },
          { label: "Afrekeningen", badge: data.invoices.length, onPress: () => setSheet("invoices") },
          { label: "Verborgen", badge: receipts.filter((r) => data.hidden.includes(r.id)).length, onPress: () => setSheet("hidden") },
          { label: "Server wisselen", destructive: true, onPress: () => setSheet("switch") },
        ]}
      />

      <ConfirmDialog
        visible={sheet === "switch"}
        title="Server wisselen?"
        message={
          "De app vergeet het serveradres en de sleutel en toont het verbindscherm. Je bonnetjes en verdeling blijven op de server staan. Houd het adres en de sleutel bij de hand om weer te verbinden." +
          (hasUnsentChanges() ? "\n\nLet op: er zijn wijzigingen die nog niet naar de server zijn gestuurd. Die gaan verloren." : "")
        }
        confirmLabel="Server wisselen"
        onConfirm={disconnect}
        onCancel={() => setSheet(null)}
      />

      <InvoiceSheet
        invoice={invoiceShown}
        onClose={() => setInvoiceShown(null)}
        onDelete={(inv) => {
          persistData({ ...data, invoices: data.invoices.filter((i) => i.id !== inv.id) });
          setInvoiceShown(null);
        }}
      />

      <InvoicesSheet
        visible={sheet === "invoices"}
        invoices={data.invoices}
        onOpen={(inv) => {
          setSheet(null);
          setInvoiceShown(inv);
        }}
        onClose={() => setSheet(null)}
      />

      <HiddenSheet
        visible={sheet === "hidden"}
        receipts={receipts}
        data={data}
        onRestore={(ids) => persistData({ ...data, hidden: data.hidden.filter((id) => !ids.includes(id)) })}
        onDelete={deleteHidden}
        onClose={() => setSheet(null)}
      />

      <ScanSheet visible={sheet === "scan"} onClose={() => setSheet(null)} onScanned={handleScanned} />

      <AddPersonSheet
        visible={sheet === "add"}
        people={data.people}
        onAdd={(name) => {
          persistData({ ...data, people: [...data.people, name] });
          setSheet(null);
        }}
        onClose={() => setSheet(null)}
      />

      <PersonSheet
        name={personShown}
        data={data}
        onRemove={(name) => {
          persistData({ ...data, people: data.people.filter((p) => p !== name), reservations: withoutReservation(data, name) });
          setPersonShown(null);
        }}
        onClose={() => setPersonShown(null)}
      />

      <PaymentSheet
        visible={sheet === "pay"}
        person={payTarget.person}
        amount={payTarget.amount}
        invoiceNumber={(payTarget.person && data.reservations?.[payTarget.person]) || ""}
        onRefreshNumber={() => payTarget.person && persistData(reserveNumber(data, payTarget.person, new Date(), true))}
        onPaid={() => {
          setSheet(null);
          if (payTarget.person) markAllPaid(payTarget.person);
        }}
        onClose={() => setSheet(null)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  empty: { textAlign: "center", padding: 40, color: colors.faint, lineHeight: 21 },
});
