import React, { useLayoutEffect, useState } from "react";
import { View, FlatList, StyleSheet, Alert, ActivityIndicator, Pressable } from "react-native";
import { ScreenProps } from "../navigation";
import { useAppData } from "../context";
import { describeError } from "../api";
import { Assignment, Invoice } from "../types";
import { colors, radius } from "../theme";
import ProductItem from "../components/ProductItem";
import TallySection from "../components/TallySection";
import PersonPicker from "../components/PersonPicker";
import BatchBar from "../components/BatchBar";
import DiscountLinkSheet from "../components/DiscountLinkSheet";
import HeaderMenu, { HamburgerIcon, headerButtonStyle } from "../components/HeaderMenu";
import ConfirmDialog from "../components/ConfirmDialog";
import InvoiceSheet from "../components/InvoiceSheet";
import ReceiptHeader from "../components/ReceiptHeader";
import ReceiptActions from "../components/ReceiptActions";
import { DiscountSections, UnlinkedBanner } from "../components/DiscountSections";
import { useDiscountLinker } from "../hooks/useDiscountLinker";
import { useFinishReceipt } from "../hooks/useFinishReceipt";
import { useReceiptActions } from "../hooks/useReceiptActions";
import { useReceiptDetail } from "../hooks/useReceiptDetail";
import { useSelection } from "../hooks/useSelection";

export default function ReceiptDetailScreen({ route, navigation }: ScreenProps<"Detail">) {
  const { receiptId } = route.params;
  const { data, persistData, receipts } = useAppData();
  const receipt = receipts.find((r) => r.id === receiptId);

  const detail = useReceiptDetail(receiptId);
  const { products, resolved } = detail;
  const actions = useReceiptActions(receiptId, detail);
  const batch = useSelection<number>();
  const linker = useDiscountLinker();

  // Kept after the picker closes, so its title does not empty while it slides away.
  const [pickingIndex, setPickingIndex] = useState(-1);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [resetVisible, setResetVisible] = useState(false);
  const [invoiceShown, setInvoiceShown] = useState<Invoice | null>(null);

  const { finish, dialog: finishDialog } = useFinishReceipt({
    data,
    persistData,
    loadPricing: async () => ({ products, discountMap: resolved.map, unmatched: resolved.unmatched }), // already in memory on this screen
    onFinished: () => navigation.goBack(),
    onError: (e) => Alert.alert("Afronden lukte niet", describeError(e)),
  });

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable accessibilityLabel="Menu" onPress={() => setMenuVisible(true)} hitSlop={10} style={headerButtonStyle}>
          <HamburgerIcon />
        </Pressable>
      ),
    });
  }, [navigation]);

  if (detail.loading) {
    return (
      <View style={s.loading}>
        <ActivityIndicator color={colors.sub} size="large" />
      </View>
    );
  }

  const isDone = data.completed.includes(receiptId);
  const receiptPaid = data.paid[receiptId] || {};
  const assignments = data.assignments[receiptId] || {};
  const assignedCount = products.filter((_, i) => assignments[i]).length;

  const isPaid = (a?: Assignment) => !!a && ("person" in a ? !!receiptPaid[a.person] : a.split.some((p) => receiptPaid[p]));

  function pressProduct(index: number) {
    if (batch.active) {
      batch.toggle(index);
    } else {
      setPickingIndex(index);
      setPickerVisible(true);
    }
  }

  const header = (
    <View>
      <UnlinkedBanner count={resolved.unmatched.length} onPress={() => linker.open(resolved.unmatched[0].name)} />
      <ReceiptHeader
        receipt={receipt}
        productCount={products.length}
        assignedCount={assignedCount}
        isDone={isDone}
        batchActive={batch.active}
        onToggleBatch={batch.active ? batch.stop : batch.start}
      />
    </View>
  );

  const footer = (
    <View>
      <View style={s.stripEnd} />
      <DiscountSections unmatched={resolved.unmatched} linked={resolved.linked} products={products} onOpen={linker.open} />
      <TallySection
        receiptId={receiptId}
        products={products}
        discountMap={resolved.map}
        unmatchedDiscounts={resolved.unmatched}
        data={data}
        onSetPaid={(person, paid) => {
          const invoice = actions.setPaid(person, paid);
          if (invoice) setInvoiceShown(invoice);
        }}
      />
      <ReceiptActions
        isDone={isDone}
        onFinish={() => finish(receiptId)}
        onReopen={actions.reopen}
        onHide={() => {
          actions.hide();
          navigation.goBack();
        }}
      />
      {batch.active && <View style={{ height: 300 }} />}
    </View>
  );

  return (
    <View style={s.container}>
      <FlatList
        data={products}
        keyExtractor={(_, i) => String(i)}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        renderItem={({ item, index }) => (
          <ProductItem
            product={item}
            index={index}
            assignment={assignments[index]}
            discount={resolved.map[index] || 0}
            isPaid={isPaid(assignments[index])}
            selected={batch.selected.has(index)}
            onPress={() => pressProduct(index)}
          />
        )}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      />

      {batch.active && batch.selected.size > 0 && (
        <BatchBar
          count={batch.selected.size}
          onAssign={(person) => {
            actions.assign(batch.selected, person);
            batch.stop();
          }}
          onSplit={(people) => {
            actions.split(batch.selected, people);
            batch.stop();
          }}
          onClear={() => {
            actions.clear(batch.selected);
            batch.stop();
          }}
          onCancel={batch.stop}
        />
      )}

      <InvoiceSheet
        invoice={invoiceShown}
        onClose={() => setInvoiceShown(null)}
        onDelete={(inv) => {
          persistData({ ...data, invoices: data.invoices.filter((i) => i.id !== inv.id) });
          setInvoiceShown(null);
        }}
      />

      {finishDialog}

      <HeaderMenu
        visible={menuVisible}
        onClose={() => setMenuVisible(false)}
        items={[{ label: "Bonnetje resetten", onPress: () => setResetVisible(true) }]}
      />

      <ConfirmDialog
        visible={resetVisible}
        title="Bonnetje resetten?"
        message="Alle toewijzingen, betalingen en gekoppelde kortingen van dit bonnetje worden gewist. Het bonnetje staat daarna weer zoals bij het ophalen. Dit kan niet ongedaan worden gemaakt."
        confirmLabel="Resetten"
        onConfirm={() => {
          actions.reset();
          batch.stop();
          setResetVisible(false);
        }}
        onCancel={() => setResetVisible(false)}
      />

      <PersonPicker
        visible={pickerVisible}
        productName={products[pickingIndex]?.name || ""}
        current={assignments[pickingIndex]}
        quantity={products[pickingIndex]?.quantity}
        onAssign={(person) => actions.assign([pickingIndex], person)}
        onSplit={(people) => actions.split([pickingIndex], people)}
        onClear={() => actions.clear([pickingIndex])}
        onClose={() => setPickerVisible(false)}
      />

      <DiscountLinkSheet
        discountName={linker.name}
        products={products}
        selection={linker.selection}
        onToggle={linker.toggle}
        onSave={() => {
          if (!linker.name) return;
          actions.saveLinks(linker.name, [...linker.selection].sort((a, b) => a - b));
          linker.close();
        }}
        onClose={linker.close}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, backgroundColor: colors.bg, justifyContent: "center", alignItems: "center" },
  stripEnd: { height: 16, backgroundColor: colors.surface, borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg },
});
