export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface PrintfulClientOptions {
  token: string;
  baseUrl?: string;
}

export class PrintfulClient {
  private readonly token: string;
  private readonly baseUrl: string;

  constructor(options: PrintfulClientOptions) {
    this.token = options.token;
    this.baseUrl = options.baseUrl ?? 'https://api.printful.com';
  }

  private async request<TResponse>(
    path: string,
    method: HttpMethod,
    body?: unknown
  ): Promise<TResponse> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Printful API error ${response.status}: ${text}`);
    }

    return (await response.json()) as TResponse;
  }

  getProducts(params?: { category_id?: number; offset?: number; limit?: number }) {
    const qs = new URLSearchParams();
    if (params?.category_id !== undefined) qs.set('category_id', String(params.category_id));
    if (params?.offset !== undefined) qs.set('offset', String(params.offset));
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));

    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return this.request(`/products${suffix}`, 'GET');
  }

  getProductById(id: number) {
    return this.request(`/products/${id}`, 'GET');
  }

  getOrders(params?: { offset?: number; limit?: number; status?: string; search?: string }) {
    const qs = new URLSearchParams();
    if (params?.offset !== undefined) qs.set('offset', String(params.offset));
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));
    if (params?.status !== undefined) qs.set('status', params.status);
    if (params?.search !== undefined) qs.set('search', params.search);

    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return this.request(`/orders${suffix}`, 'GET');
  }

  createOrder(payload: unknown) {
    return this.request('/orders', 'POST', payload);
  }

  confirmOrderById(id: string, payload?: unknown) {
    return this.request(`/orders/${id}/confirm`, 'POST', payload);
  }

  estimateOrderCosts(payload: unknown) {
    return this.request('/orders/estimate-costs', 'POST', payload);
  }

  getShippingRates(payload: unknown) {
    return this.request('/shipping/rates', 'POST', payload);
  }

  createGeneratorTask(id: number, payload: unknown) {
    return this.request(`/mockup-generator/create-task/${id}`, 'POST', payload);
  }

  getGeneratorTask(task_key: string) {
    return this.request(`/mockup-generator/task?task_key=${encodeURIComponent(task_key)}`, 'GET');
  }
}

// Example usage
async function exampleUsage() {
  const client = new PrintfulClient({ token: '<token>' });

  const products = await client.getProducts({ limit: 20, offset: 0 });
  console.log('Products:', products);

  const product = await client.getProductById(71);
  console.log('Single product:', product);

  const costs = await client.estimateOrderCosts({
    recipient: {
      name: 'Ola Nordmann',
      address1: 'Karl Johans gate 1',
      city: 'Oslo',
      country_code: 'NO',
      zip: '0154',
    },
    items: [{ variant_id: 4012, quantity: 1 }],
  });
  console.log('Estimated costs:', costs);
}

void exampleUsage;
