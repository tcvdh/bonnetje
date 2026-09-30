import { NativeStackScreenProps } from "@react-navigation/native-stack";

/** Every screen and what it is opened with. Screens take their props from `ScreenProps<"Name">`. */
export type RootStackParamList = {
  List: undefined;
  Detail: { receiptId: string };
};

export type ScreenProps<Name extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, Name>;
