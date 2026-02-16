export interface OrderEventV1 {
  event_type: "OrderPlaced";
  event_version: 1;
  order_id: string;
  user_id: string;
  total_amount: number;
}

export interface OrderEventV2 extends Omit<OrderEventV1, "event_version"> {
  event_version: 2;
  device_fingerprint: string;
  ip_address: string;
  payment_method_bin: string;
}

export type OrderEvent = OrderEventV1 | OrderEventV2;
