export interface SsotSource {
	id: string;
	name: string;
	url: string;
	feed_url?: string;
	description: string;
	meta_url?: string;
	custom_extraction_instruction?: string;
}

export interface SsotConfig {
	ssot_sources: SsotSource[];
}

export interface SourceState {
	last_checked: string;
	content_hash: string;
	last_modified_header: string | null;
}

export interface CrawlerState {
	last_execution: string;
	sources: Record<string, SourceState>;
}
