/**
 * TradeFlowHelpContent.gs
 * Bundled Standard TradeFlow help articles.
 *
 * This source is safe to ship with the app. It must not include spreadsheet IDs,
 * deployment IDs, secrets, tenant data, customer records, or private URLs.
 */

var TRADEFLOW_HELP_ARTICLES = {
  'products.add': {
    key: 'products.add',
    title: 'Add Product',
    summary: 'Create a local TradeFlow product and initial FIFO batch from owner-entered business values.',
    readMorePath: 'Docs/tradeflow/user-playbook/products/add.md',
    expectedResult: 'The product appears in Products with the entered cost, selling price, stock, max stock, and any explicitly entered, scanned, or generated barcode. Initial stock creates the first FIFO batch.',
    mistakes: [
      'Saving before entering a product name, category, unit, cost, selling price, or max stock.',
      'Entering the supplier cost or selling price in the wrong unit.',
      'Selecting a catalogue identity and then changing local business values without reviewing them.'
    ],
    recovery: [
      'Edit the product row to correct local name, category, primary barcode, extra barcodes, max stock, or selling price.',
      'Use stock adjustment or restock workflows to correct quantity rather than deleting history.',
      'Use the Central Catalogue mapping action only for identity changes; it does not change local price or stock.'
    ]
  },
  'products.find-ncpc': {
    key: 'products.find-ncpc',
    title: 'Find In Catalogue',
    summary: 'Search the approved local Central Catalogue release only when the admin explicitly asks for a match.',
    readMorePath: 'Docs/tradeflow/user-playbook/products/find-ncpc.md',
    expectedResult: 'Candidate results show approved catalogue identities that can autofill product identity fields while business values remain local.',
    mistakes: [
      'Expecting search to run automatically while typing.',
      'Treating a Central Catalogue match as a source for local price, cost, stock, supplier, or availability.',
      'Searching before an approved release export has been loaded.'
    ],
    recovery: [
      'Run Find in Catalogue again with a clearer product name, brand, variant, or barcode.',
      'Load only an approved published-release export if the local cache is empty.',
      'Use Enter Product Manually when no candidate is correct.'
    ]
  },
  'products.link': {
    key: 'products.link',
    title: 'Link Product Identity',
    summary: 'Attach one approved Central Catalogue product and variant identity to a local TradeFlow product so Ntheemba can identify it more reliably on WhatsApp.',
    readMorePath: 'Docs/tradeflow/user-playbook/products/link.md',
    expectedResult: 'The local product keeps its TradeFlow price, stock, cost, supplier, and batches while storing catalogue identifiers in the mapping. Linking does not send shop price, cost, stock, supplier, or batches to the Central Catalogue.',
    mistakes: [
      'Choosing a similar but incorrect variant or size.',
      'Assuming the link imports catalogue descriptions or business values.',
      'Trying to link the same active catalogue variant to more than one active local product.'
    ],
    recovery: [
      'Use Change Link from the product Central Catalogue action to select the correct approved variant.',
      'Remove the mapping when the link is wrong and no replacement is ready.',
      'Keep Publish NCPC identity off until the owner has confirmed the canonical identity is safe for the strict NCPC-variant integration route. General TradeFlow product search remains available for active local products.'
    ]
  },
  'products.review-match': {
    key: 'products.review-match',
    title: 'Review Match',
    summary: 'Review a suggested or uncertain catalogue match before saving it as the product identity.',
    readMorePath: 'Docs/tradeflow/user-playbook/products/review-match.md',
    expectedResult: 'Only a confirmed product and variant pair becomes a linked mapping.',
    mistakes: [
      'Approving a match based on name only without checking variant, size, unit, or barcode.',
      'Leaving a stale or error mapping unresolved.',
      'Publishing a match before the owner confirms it.'
    ],
    recovery: [
      'Search again with more precise terms.',
      'Remove the mapping when identity cannot be trusted.',
      'Enter the product manually when no approved match is correct.'
    ]
  },
  'products.submit-new': {
    key: 'products.submit-new',
    title: 'Enter Product Manually',
    summary: 'Create a usable local product while recording a fake/local pending Central Catalogue review for products with no correct match.',
    readMorePath: 'Docs/tradeflow/user-playbook/products/submit-new.md',
    expectedResult: 'TradeFlow creates the local product and initial batch immediately, then stores AWAITING_NCPC_REVIEW submission metadata without making it public.',
    mistakes: [
      'Submitting when a correct approved catalogue candidate already exists.',
      'Expecting Central Catalogue review to block local selling or stock workflows.',
      'Refreshing the modal and accidentally losing the original submission request context.'
    ],
    recovery: [
      'Use the existing product if the same submission request was already processed.',
      'Use Check Status to refresh the local pending status.',
      'Change or remove the mapping later after Central Catalogue review resolves the submitted identity.'
    ]
  },
  'products.submission-status': {
    key: 'products.submission-status',
    title: 'Review Status',
    summary: 'Check local pending-review submission metadata through the replaceable catalogue client boundary.',
    readMorePath: 'Docs/tradeflow/user-playbook/products/submission-status.md',
    expectedResult: 'The product remains usable and the mapping records the latest local pending status check.',
    mistakes: [
      'Treating the Sprint-01 fake pending status as live Central Catalogue approval.',
      'Checking status for a product that is already linked or has no pending submission.',
      'Assuming status checks update price, stock, or availability.'
    ],
    recovery: [
      'Keep using the local product while review is pending.',
      'Remove the submission link if it was attached to the wrong product.',
      'Replace the fake client later without changing the Product UI workflow.'
    ]
  },
  'products.change-link': {
    key: 'products.change-link',
    title: 'Change Link',
    summary: 'Replace or remove the Central Catalogue identity mapping without changing the local TradeFlow product record.',
    readMorePath: 'Docs/tradeflow/user-playbook/products/change-link.md',
    expectedResult: 'Only `product.ncpcMapping` changes. Local stock, batches, selling price, costs, and supplier data remain unchanged.',
    mistakes: [
      'Using link changes to try to correct inventory or prices.',
      'Removing a mapping when Unpublish from the strict NCPC identity route is enough.',
      'Replacing a link without checking duplicate active VAR rules.'
    ],
    recovery: [
      'Use Unpublish to remove the mapping from the strict NCPC-variant publication route while preserving the link. It does not hide the active local product from general TradeFlow catalogue search.',
      'Use Remove mapping to clear a wrong identity link.',
      'Search and save the previous approved variant again if the replacement was mistaken.'
    ]
  },
  'products.ncpc-status': {
    key: 'products.ncpc-status',
    title: 'Central Catalogue Status And Coverage',
    summary: 'Understand row-level Central Catalogue actions and the Products-tab coverage summary. Linking products makes them easier and more reliable for Ntheemba to identify when customers ask about them on WhatsApp.',
    readMorePath: 'Docs/tradeflow/user-playbook/products/ncpc-status.md',
    expectedResult: 'Each product shows a local state such as Find Match, Review Match, Linked, Awaiting Review, Needs Attention, Link Problem, or Local Only.',
    mistakes: [
      'Expecting the Products page to contact the Central Catalogue for every row.',
      'Counting Local Only products as failed catalogue coverage.',
      'Ignoring stale or error states that need manual review.',
      'Assuming public local fallback is as reliable as a linked Central Catalogue identity.'
    ],
    recovery: [
      'Use Review Products to focus the product list and resolve rows one at a time.',
      'Open each product Central Catalogue action for mapping, status, unpublish, or removal.',
      'Use local-only intentionally for products that should not be matched to Central Catalogue.',
      'Keep Central Catalogue linkage preferred even when an explicitly public local product can still appear as a fallback.'
    ]
  }
};

function getHelpArticle(key) {
  var normalized = String(key || '').trim();
  var article = TRADEFLOW_HELP_ARTICLES[normalized];
  if (!article) {
    return {
      ok: false,
      error: {
        code: 'HELP_ARTICLE_NOT_FOUND',
        message: 'Help article not found.'
      }
    };
  }
  return {
    ok: true,
    article: JSON.parse(JSON.stringify(article))
  };
}

function listTradeFlowHelpKeys() {
  return Object.keys(TRADEFLOW_HELP_ARTICLES).sort();
}
