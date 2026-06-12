export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      cms_pets: {
        Row: {
          id: string
          management_no: string
          species: string
          breed: string | null
          birth_date: string | null
          birth_place: string | null
          gender: string | null
          price_tax_excluded: number | null
          price_tax_included: number | null
          coat_color: string | null
          vaccines: string | null
          publish_status: string | null
          store_id: number | null
          cms_category_ids: string | null
          cms_entry_id: number
          cms_updated_at: string | null
          created_at: string
          updated_at: string
          image_url: string | null
        }
        Insert: {
          id?: string
          management_no: string
          species: string
          breed?: string | null
          birth_date?: string | null
          birth_place?: string | null
          gender?: string | null
          price_tax_excluded?: number | null
          price_tax_included?: number | null
          coat_color?: string | null
          vaccines?: string | null
          publish_status?: string | null
          store_id?: number | null
          cms_category_ids?: string | null
          cms_entry_id: number
          cms_updated_at?: string | null
          created_at?: string
          updated_at?: string
          image_url?: string | null
        }
        Update: {
          id?: string
          management_no?: string
          species?: string
          breed?: string | null
          birth_date?: string | null
          birth_place?: string | null
          gender?: string | null
          price_tax_excluded?: number | null
          price_tax_included?: number | null
          coat_color?: string | null
          vaccines?: string | null
          publish_status?: string | null
          store_id?: number | null
          cms_category_ids?: string | null
          cms_entry_id?: number
          cms_updated_at?: string | null
          created_at?: string
          updated_at?: string
          image_url?: string | null
        }
        Relationships: []
      }
      customer_orders: {
        Row: {
          id: string
          order_no: string | null
          customer_name: string
          phone_number: string
          item_name: string
          item_details: string | null
          staff_name: string | null
          notes: string | null
          status: string
          store_id: number | null
          product_id: number | null
          jan_code: string | null
          quantity: number | null
          unit_price: number | null
          order_date: string | null
          expected_arrival_date: string | null
          pickup_due_date: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          order_no?: string | null
          customer_name: string
          phone_number: string
          item_name: string
          item_details?: string | null
          staff_name?: string | null
          notes?: string | null
          status?: string
          store_id?: number | null
          product_id?: number | null
          jan_code?: string | null
          quantity?: number | null
          unit_price?: number | null
          order_date?: string | null
          expected_arrival_date?: string | null
          pickup_due_date?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          order_no?: string | null
          customer_name?: string
          phone_number?: string
          item_name?: string
          item_details?: string | null
          staff_name?: string | null
          notes?: string | null
          status?: string
          store_id?: number | null
          product_id?: number | null
          jan_code?: string | null
          quantity?: number | null
          unit_price?: number | null
          order_date?: string | null
          expected_arrival_date?: string | null
          pickup_due_date?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      product_aliases: {
        Row: {
          id: number
          alias_name: string
          product_id: number
          source_system: string
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          alias_name: string
          product_id: number
          source_system?: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          alias_name?: string
          product_id?: number
          source_system?: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          id: number
          jan_code: string | null
          product_name: string | null
          cost_price: number | null
          selling_price: number | null
          category: string | null
          markup_rate: number | null
          product_group: string | null
          brand: string | null
          supplier_name: string | null
          is_active: boolean
          updated_at: string
        }
        Insert: {
          id?: number
          jan_code?: string | null
          product_name?: string | null
          cost_price?: number | null
          selling_price?: number | null
          category?: string | null
          markup_rate?: number | null
          product_group?: string | null
          brand?: string | null
          supplier_name?: string | null
          is_active?: boolean
          updated_at?: string
        }
        Update: {
          id?: number
          jan_code?: string | null
          product_name?: string | null
          cost_price?: number | null
          selling_price?: number | null
          category?: string | null
          markup_rate?: number | null
          product_group?: string | null
          brand?: string | null
          supplier_name?: string | null
          is_active?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      stores: {
        Row: {
          id: number
          name: string
        }
        Insert: {
          id?: number
          name: string
        }
        Update: {
          id?: number
          name?: string
        }
        Relationships: []
      }
      transfers: {
        Row: {
          id: number
          transfer_date: string
          from_store_id: number
          to_store_id: number | null
          jan_code: string
          product_name: string
          quantity: number
          cost_price: number
          total_cost: number
          selling_price: number
          entry_type: string
          usage_category: string | null
          memo: string | null
          created_at: string | null
        }
        Insert: {
          id?: number
          transfer_date?: string
          from_store_id: number
          to_store_id?: number | null
          jan_code: string
          product_name: string
          quantity: number
          cost_price: number
          total_cost?: number
          selling_price: number
          entry_type?: string
          usage_category?: string | null
          memo?: string | null
          created_at?: string | null
        }
        Update: {
          id?: number
          transfer_date?: string
          from_store_id?: number
          to_store_id?: number | null
          jan_code?: string
          product_name?: string
          quantity?: number
          cost_price?: number
          total_cost?: number
          selling_price?: number
          entry_type?: string
          usage_category?: string | null
          memo?: string | null
          created_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      sales_daily_summary_v: {
        Row: {
          sale_date: string
          transaction_date: string
          store_name: string
          total_quantity: number
          total_sales_amount: number
          line_count: number
          product_count: number
          estimated_cost: number | null
          estimated_profit: number | null
        }
        Relationships: []
      }
      sales_enriched_v: {
        Row: {
          sales_row_id: number
          transaction_date: string
          sale_date: string
          store_name: string
          product_name: string
          quantity: number
          total_amount: number
          sales_amount: number
          matched_product_id: number | null
          jan_code: string | null
          category: string
          product_group: string | null
          brand: string | null
          cost_price: number | null
          selling_price: number | null
          estimated_cost: number | null
          estimated_profit: number | null
          match_source: string
          unmatched_master: boolean
          created_at: string
        }
        Relationships: []
      }
      sales_product_summary_v: {
        Row: {
          sale_date: string
          transaction_date: string
          store_name: string
          product_id: number | null
          jan_code: string
          product_name: string
          category: string
          product_group: string | null
          brand: string | null
          total_quantity: number
          total_sales_amount: number
          estimated_cost: number | null
          estimated_profit: number | null
          unmatched_master: boolean
        }
        Relationships: []
      }
    }
  }
}
