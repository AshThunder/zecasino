//! In-memory compact block cache for `zcash_client_backend::sync::run`. Blocks are dropped once scanned.
use std::{collections::BTreeMap, sync::Mutex};
use async_trait::async_trait;
use zcash_client_backend::{
    data_api::{chain::{error, BlockCache, BlockSource}, scanning::ScanRange},
    proto::compact_formats::CompactBlock,
};
use zcash_protocol::consensus::BlockHeight;

#[derive(Default)]
pub struct MemCache { blocks: Mutex<BTreeMap<u32, CompactBlock>> }

#[derive(Debug)]
pub struct CacheError(pub String);
impl std::fmt::Display for CacheError { fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { f.write_str(&self.0) } }
impl std::error::Error for CacheError {}

impl BlockSource for MemCache {
    type Error = CacheError;
    fn with_blocks<F, WalletErrT>(&self, from_height: Option<BlockHeight>, limit: Option<usize>, mut with_block: F) -> Result<(), error::Error<WalletErrT, Self::Error>>
    where F: FnMut(CompactBlock) -> Result<(), error::Error<WalletErrT, Self::Error>> {
        let from = from_height.map(u32::from).unwrap_or(0);
        let blocks: Vec<CompactBlock> = self.blocks.lock().unwrap().range(from..).take(limit.unwrap_or(usize::MAX)).map(|(_, b)| b.clone()).collect();
        for b in blocks { with_block(b)?; }
        Ok(())
    }
}

#[async_trait]
impl BlockCache for MemCache {
    fn get_tip_height(&self, range: Option<&ScanRange>) -> Result<Option<BlockHeight>, Self::Error> {
        let b = self.blocks.lock().unwrap();
        Ok(match range {
            Some(r) => b.range(u32::from(r.block_range().start)..u32::from(r.block_range().end)).next_back().map(|(h, _)| BlockHeight::from_u32(*h)),
            None => b.keys().next_back().map(|h| BlockHeight::from_u32(*h)),
        })
    }
    async fn read(&self, range: &ScanRange) -> Result<Vec<CompactBlock>, Self::Error> {
        let b = self.blocks.lock().unwrap();
        Ok(b.range(u32::from(range.block_range().start)..u32::from(range.block_range().end)).map(|(_, v)| v.clone()).collect())
    }
    async fn insert(&self, compact_blocks: Vec<CompactBlock>) -> Result<(), Self::Error> {
        let mut b = self.blocks.lock().unwrap();
        for cb in compact_blocks { b.insert(cb.height as u32, cb); }
        Ok(())
    }
    async fn delete(&self, range: ScanRange) -> Result<(), Self::Error> {
        let mut b = self.blocks.lock().unwrap();
        b.retain(|h, _| !range.block_range().contains(&BlockHeight::from_u32(*h)));
        Ok(())
    }
}
