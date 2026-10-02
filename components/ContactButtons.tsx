"use client";

import { MessageCircle, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { telHref, whatsAppHref } from "@/lib/contact";
import type { ServiceDTO } from "@/lib/types";

export function ContactButtons({ service }: { service: ServiceDTO }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <Button asChild size="sm" variant="outline">
        <a href={telHref(service.phone)} title={`কল করুন: ${service.phone}`}>
          <Phone className="mr-1 h-3.5 w-3.5" />
          কল
        </a>
      </Button>
      <Button
        asChild
        size="sm"
        className="bg-green-600 text-white hover:bg-green-700"
      >
        <a
          href={whatsAppHref(service)}
          target="_blank"
          rel="noreferrer"
          title={`WhatsApp: ${service.phone}`}
        >
          <MessageCircle className="mr-1 h-3.5 w-3.5" />
          WhatsApp
        </a>
      </Button>
    </div>
  );
}
